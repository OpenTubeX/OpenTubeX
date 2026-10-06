package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"testing"
	"time"

	"github.com/gogo/protobuf/proto"
	pb "github.com/vishen/go-chromecast/cast/proto"
)

func issueCertificate(t *testing.T, template, parent *x509.Certificate, publicKey *rsa.PublicKey, signer *rsa.PrivateKey) *x509.Certificate {
	t.Helper()
	der, err := x509.CreateCertificate(rand.Reader, template, parent, publicKey, signer)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert
}

func authFixture(t *testing.T) (*x509.Certificate, *x509.Certificate, *x509.Certificate, *rsa.PrivateKey, *x509.CertPool) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	rootTemplate := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Test root"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	root := issueCertificate(t, rootTemplate, rootTemplate, &key.PublicKey, key)
	intermediateTemplate := *rootTemplate
	intermediateTemplate.SerialNumber = big.NewInt(2)
	intermediateTemplate.Subject.CommonName = "Test intermediate"
	intermediate := issueCertificate(t, &intermediateTemplate, root, &key.PublicKey, key)
	deviceKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	deviceTemplate := &x509.Certificate{SerialNumber: big.NewInt(3), Subject: pkix.Name{CommonName: "Test Cast device"},
		NotBefore: rootTemplate.NotBefore, NotAfter: rootTemplate.NotAfter, KeyUsage: x509.KeyUsageDigitalSignature}
	device := issueCertificate(t, deviceTemplate, intermediate, &deviceKey.PublicKey, key)
	roots := x509.NewCertPool()
	roots.AddCert(root)
	return device, intermediate, root, deviceKey, roots
}

func signedResponse(t *testing.T, device, intermediate *x509.Certificate, key *rsa.PrivateKey, nonce, peerDER []byte) *authResponse {
	t.Helper()
	digest := sha256.Sum256(append(append([]byte{}, nonce...), peerDER...))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return &authResponse{Signature: signature, ClientAuthCertificate: device.Raw, IntermediateCertificate: [][]byte{intermediate.Raw},
		SenderNonce: nonce, HashAlgorithm: proto.Uint32(1), SignatureAlgorithm: proto.Uint32(1)}
}

func TestDeviceAuthenticationVerification(t *testing.T) {
	device, intermediate, _, key, roots := authFixture(t)
	nonce, peerDER := []byte("challenge nonce!"), []byte("TLS certificate DER")
	for _, scenario := range []string{"valid", "wrong nonce", "changed TLS certificate", "bad signature", "untrusted", "missing intermediate", "expired", "wrong hash", "wrong signature algorithm", "malformed certificate"} {
		t.Run(scenario, func(t *testing.T) {
			response := signedResponse(t, device, intermediate, key, nonce, peerDER)
			pool, now, peer := roots, time.Now(), peerDER
			switch scenario {
			case "wrong nonce":
				response.SenderNonce = []byte("a different nonce")
			case "changed TLS certificate":
				peer = []byte("other peer certificate")
			case "bad signature":
				response.Signature[0] ^= 1
			case "untrusted":
				pool = castRoots()
			case "missing intermediate":
				response.IntermediateCertificate = nil
			case "expired":
				now = now.Add(48 * time.Hour)
			case "wrong hash":
				response.HashAlgorithm = proto.Uint32(0)
			case "wrong signature algorithm":
				response.SignatureAlgorithm = proto.Uint32(2)
			case "malformed certificate":
				response.ClientAuthCertificate = []byte("invalid")
			}
			err := verifyReceiver(response, nonce, peer, pool, now)
			if (err == nil) != (scenario == "valid") {
				t.Fatalf("unexpected verification result: %v", err)
			}
		})
	}
}

func TestRejectsAudioOnlyDeviceCertificate(t *testing.T) {
	_, _, _, key, _ := authFixture(t)
	rootTemplate := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Audio-only CA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true,
		BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	intermediate := issueCertificate(t, rootTemplate, rootTemplate, &key.PublicKey, key)
	roots := x509.NewCertPool()
	roots.AddCert(intermediate)
	audioOnlyPolicy, err := x509.OIDFromInts([]uint64{1, 3, 6, 1, 4, 1, 11129, 2, 5, 2})
	if err != nil {
		t.Fatal(err)
	}
	deviceTemplate := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "Audio-only device"},
		NotBefore: rootTemplate.NotBefore, NotAfter: rootTemplate.NotAfter, KeyUsage: x509.KeyUsageDigitalSignature,
		Policies: []x509.OID{audioOnlyPolicy}}
	device := issueCertificate(t, deviceTemplate, intermediate, &key.PublicKey, key)
	nonce, peer := []byte("nonce"), []byte("peer")
	if err := verifyReceiver(signedResponse(t, device, intermediate, key, nonce, peer), nonce, peer, roots, time.Now()); err == nil {
		t.Fatal("accepted an audio-only certificate for video casting")
	}
}

func TestAuthenticationExchange(t *testing.T) {
	device, intermediate, _, key, roots := authFixture(t)
	left, right := net.Pipe()
	defer left.Close()
	defer right.Close()
	client, receiver := &transport{connection: left}, &transport{connection: right}
	result := make(chan error, 1)
	go func() { result <- authenticateReceiver(client, device, roots) }()
	message, err := receiver.receive()
	if err != nil {
		t.Fatal(err)
	}
	if message.GetNamespace() != deviceAuthNamespace || message.GetPayloadType() != pb.CastMessage_BINARY {
		t.Fatalf("first message was not device authentication: %v", message)
	}
	challenge := &authMessage{}
	if err := proto.Unmarshal(message.GetPayloadBinary(), challenge); err != nil {
		t.Fatal(err)
	}
	if challenge.Challenge == nil || len(challenge.Challenge.SenderNonce) != 16 {
		t.Fatal("missing challenge nonce")
	}
	// An intervening heartbeat must be answered while the auth deadline remains.
	if err := receiver.send("receiver-0", "sender-0", "urn:x-cast:com.google.cast.tp.heartbeat", map[string]string{"type": "PING"}); err != nil {
		t.Fatal(err)
	}
	if _, err := receiver.receive(); err != nil {
		t.Fatal(err)
	}
	response, err := proto.Marshal(&authMessage{Response: signedResponse(t, device, intermediate, key, challenge.Challenge.SenderNonce, device.Raw)})
	if err != nil {
		t.Fatal(err)
	}
	if err := receiver.writeMessage(&pb.CastMessage{ProtocolVersion: pb.CastMessage_CASTV2_1_0.Enum(), SourceId: proto.String("receiver-0"),
		DestinationId: proto.String("sender-0"), Namespace: proto.String(deviceAuthNamespace), PayloadType: pb.CastMessage_BINARY.Enum(), PayloadBinary: response}); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func TestPackagedCastRoots(t *testing.T) {
	data, count := castRootPEM, 0
	for len(data) > 0 {
		block, remaining := pem.Decode(data)
		if block == nil {
			t.Fatal("invalid packaged root")
		}
		certificate, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			t.Fatal(err)
		}
		if !certificate.IsCA || time.Now().After(certificate.NotAfter) {
			t.Fatal("invalid root certificate")
		}
		count++
		data = remaining
	}
	if count != 2 {
		t.Fatalf("expected two pinned roots, got %d", count)
	}
}
