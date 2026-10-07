package main

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/sha256"
	stdx509 "crypto/x509"
	_ "embed"
	"errors"
	"fmt"
	"time"

	"github.com/gogo/protobuf/proto"
	x509 "github.com/google/certificate-transparency-go/x509"
	pb "github.com/vishen/go-chromecast/cast/proto"
)

// The two pinned trust anchors from OpenScreen's cast/common/certificate:
// cast_root_ca_cert_der-inc.h and eureka_root_ca_der-inc.h.
// https://chromium.googlesource.com/openscreen/+/refs/heads/main/cast/common/certificate/
// Their source license is included in OpenScreen.LICENSE.
//
//go:embed cast_roots.pem
var castRootPEM []byte

const deviceAuthNamespace = "urn:x-cast:com.google.cast.tp.deviceauth"

var errUntrustedCastCertificate = errors.New("untrusted Cast device certificate")

func castRoots() *x509.CertPool {
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(castRootPEM) {
		panic("invalid packaged Cast roots")
	}
	return roots
}

// go-chromecast's protocol definitions predate nonce, intermediate certificates
// and SHA256. These fields follow OpenScreen's cast_channel.proto wire format.
type authChallenge struct {
	SignatureAlgorithm *uint32 `protobuf:"varint,1,opt,name=signature_algorithm"`
	SenderNonce        []byte  `protobuf:"bytes,2,opt,name=sender_nonce"`
	HashAlgorithm      *uint32 `protobuf:"varint,3,opt,name=hash_algorithm"`
}

func (m *authChallenge) Reset()         { *m = authChallenge{} }
func (m *authChallenge) String() string { return proto.CompactTextString(m) }
func (*authChallenge) ProtoMessage()    {}

type authResponse struct {
	Signature               []byte   `protobuf:"bytes,1,req,name=signature"`
	ClientAuthCertificate   []byte   `protobuf:"bytes,2,req,name=client_auth_certificate"`
	IntermediateCertificate [][]byte `protobuf:"bytes,3,rep,name=intermediate_certificate"`
	SignatureAlgorithm      *uint32  `protobuf:"varint,4,opt,name=signature_algorithm"`
	SenderNonce             []byte   `protobuf:"bytes,5,opt,name=sender_nonce"`
	HashAlgorithm           *uint32  `protobuf:"varint,6,opt,name=hash_algorithm"`
}

func (m *authResponse) Reset()         { *m = authResponse{} }
func (m *authResponse) String() string { return proto.CompactTextString(m) }
func (*authResponse) ProtoMessage()    {}

type authMessage struct {
	Challenge *authChallenge `protobuf:"bytes,1,opt,name=challenge"`
	Response  *authResponse  `protobuf:"bytes,2,opt,name=response"`
	Error     *pb.AuthError  `protobuf:"bytes,3,opt,name=error"`
}

func (m *authMessage) Reset()         { *m = authMessage{} }
func (m *authMessage) String() string { return proto.CompactTextString(m) }
func (*authMessage) ProtoMessage()    {}

func authenticateReceiver(channel *transport, peer *stdx509.Certificate, roots *x509.CertPool) error {
	// The ephemeral TLS certificate is the signed challenge's expiration bound.
	now := time.Now()
	if now.Before(peer.NotBefore) || now.After(peer.NotAfter) || peer.NotAfter.After(now.Add(4*24*time.Hour)) {
		return fmt.Errorf("invalid Cast TLS certificate validity")
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	challenge, err := proto.Marshal(&authMessage{Challenge: &authChallenge{
		SignatureAlgorithm: proto.Uint32(1), SenderNonce: nonce, HashAlgorithm: proto.Uint32(1),
	}})
	if err != nil {
		return err
	}
	if err := channel.writeMessage(&pb.CastMessage{
		ProtocolVersion: pb.CastMessage_CASTV2_1_0.Enum(), SourceId: proto.String("sender-0"),
		DestinationId: proto.String("receiver-0"), Namespace: proto.String(deviceAuthNamespace),
		PayloadType: pb.CastMessage_BINARY.Enum(), PayloadBinary: challenge,
	}); err != nil {
		return err
	}
	deadline := now.Add(5 * time.Second)
	for {
		message, err := channel.receiveBefore(deadline)
		if err != nil {
			return fmt.Errorf("Cast device authentication failed: %w", err)
		}
		if message.GetNamespace() == "urn:x-cast:com.google.cast.tp.heartbeat" {
			continue
		}
		if message.GetNamespace() != deviceAuthNamespace || message.GetSourceId() != "receiver-0" ||
			message.GetDestinationId() != "sender-0" || message.GetPayloadType() != pb.CastMessage_BINARY {
			return fmt.Errorf("invalid Cast authentication reply")
		}
		reply := &authMessage{}
		if err := proto.Unmarshal(message.GetPayloadBinary(), reply); err != nil {
			return err
		}
		if reply.Error != nil || reply.Response == nil {
			return fmt.Errorf("Cast receiver did not authenticate")
		}
		return verifyReceiver(reply.Response, nonce, peer.Raw, roots, now)
	}
}

func verifyReceiver(response *authResponse, nonce, peerDER []byte, roots *x509.CertPool, now time.Time) error {
	// Older receivers omit the nonce and sign only the short-lived TLS certificate.
	// A returned nonce must still match the fresh challenge.
	if (len(response.SenderNonce) != 0 && !bytes.Equal(response.SenderNonce, nonce)) || (response.HashAlgorithm != nil && *response.HashAlgorithm > 1) ||
		(response.SignatureAlgorithm != nil && *response.SignatureAlgorithm != 1) {
		return fmt.Errorf("invalid Cast authentication challenge response")
	}
	device, err := x509.ParseCertificate(response.ClientAuthCertificate)
	if x509.IsFatal(err) {
		return err
	}
	key, ok := device.PublicKey.(*rsa.PublicKey)
	if !ok || key.N.BitLen() < 2048 || device.IsCA || device.KeyUsage&x509.KeyUsageDigitalSignature == 0 {
		return fmt.Errorf("invalid Cast device signing certificate")
	}
	intermediates := x509.NewCertPool()
	for _, der := range response.IntermediateCertificate {
		certificate, err := x509.ParseCertificate(der)
		if x509.IsFatal(err) {
			return err
		}
		intermediates.AddCert(certificate)
	}
	// Cast PKI uses SHA-1 certificate signatures, which Go 1.24+ no longer
	// accepts. This verifier retains path, validity and critical-extension
	// checks against only the pinned Cast roots.
	chains, err := device.Verify(x509.VerifyOptions{Roots: roots, Intermediates: intermediates,
		CurrentTime: now, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageAny}})
	if err != nil {
		return fmt.Errorf("%w: %w", errUntrustedCastCertificate, err)
	}
	for _, certificate := range chains[0] {
		for _, policy := range certificate.PolicyIdentifiers {
			if policy.String() == "1.3.6.1.4.1.11129.2.5.2" {
				return fmt.Errorf("Cast certificate is restricted to audio")
			}
		}
	}
	signed := append(append([]byte{}, response.SenderNonce...), peerDER...)
	hash, digest := crypto.SHA256, sha256.New()
	// Request SHA256, but verify legacy replies using their declared hash.
	// The protocol defaults an omitted hash_algorithm to SHA1.
	if response.HashAlgorithm == nil || *response.HashAlgorithm == 0 {
		hash, digest = crypto.SHA1, sha1.New()
	}
	digest.Write(signed)
	if err := rsa.VerifyPKCS1v15(key, hash, digest.Sum(nil), response.Signature); err != nil {
		return fmt.Errorf("invalid Cast device authentication signature: %w", err)
	}
	return nil
}
