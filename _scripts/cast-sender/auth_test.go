package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"testing"
	"time"

	"github.com/gogo/protobuf/proto"
	castx509 "github.com/google/certificate-transparency-go/x509"
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

func testCastRoots(t *testing.T, root *x509.Certificate) *castx509.CertPool {
	t.Helper()
	roots := castx509.NewCertPool()
	if !roots.AppendCertsFromPEM(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: root.Raw})) {
		t.Fatal("invalid test root")
	}
	return roots
}

func authFixture(t *testing.T) (*x509.Certificate, *x509.Certificate, *x509.Certificate, *rsa.PrivateKey, *castx509.CertPool) {
	return authFixtureAlgorithms(t, x509.SHA256WithRSA, x509.SHA256WithRSA)
}

func authFixtureAlgorithms(t *testing.T, deviceAlgorithm, intermediateAlgorithm x509.SignatureAlgorithm) (*x509.Certificate, *x509.Certificate, *x509.Certificate, *rsa.PrivateKey, *castx509.CertPool) {
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
	intermediateTemplate.SignatureAlgorithm = intermediateAlgorithm
	intermediate := issueCertificate(t, &intermediateTemplate, root, &key.PublicKey, key)
	deviceKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	deviceTemplate := &x509.Certificate{SerialNumber: big.NewInt(3), Subject: pkix.Name{CommonName: "Test Cast device"},
		NotBefore: rootTemplate.NotBefore, NotAfter: rootTemplate.NotAfter, KeyUsage: x509.KeyUsageDigitalSignature, SignatureAlgorithm: deviceAlgorithm}
	device := issueCertificate(t, deviceTemplate, intermediate, &deviceKey.PublicKey, key)
	roots := testCastRoots(t, root)
	return device, intermediate, root, deviceKey, roots
}

func TestSHA1CastCertificateChains(t *testing.T) {
	for _, algorithms := range [][2]x509.SignatureAlgorithm{
		{x509.SHA1WithRSA, x509.SHA256WithRSA},
		{x509.SHA256WithRSA, x509.SHA1WithRSA},
		{x509.SHA1WithRSA, x509.SHA1WithRSA},
	} {
		t.Run(algorithms[0].String()+"/"+algorithms[1].String(), func(t *testing.T) {
			device, intermediate, _, key, roots := authFixtureAlgorithms(t, algorithms[0], algorithms[1])
			nonce, peer := []byte("challenge nonce!"), []byte("TLS certificate DER")
			if err := verifyReceiver(signedResponse(t, device, intermediate, key, nonce, peer), nonce, peer, roots, time.Now()); err != nil {
				t.Fatal(err)
			}
			for _, scenario := range []string{"expired", "not yet valid", "untrusted", "missing intermediate", "bad certificate signature", "mismatched challenge hash"} {
				t.Run(scenario, func(t *testing.T) {
					response := signedResponse(t, device, intermediate, key, nonce, peer)
					pool, now := roots, time.Now()
					switch scenario {
					case "expired":
						now = now.Add(48 * time.Hour)
					case "not yet valid":
						now = now.Add(-2 * time.Hour)
					case "untrusted":
						pool = castRoots()
					case "missing intermediate":
						response.IntermediateCertificate = nil
					case "bad certificate signature":
						response.ClientAuthCertificate = append([]byte{}, device.Raw...)
						response.ClientAuthCertificate[len(response.ClientAuthCertificate)-1] ^= 1
					case "mismatched challenge hash":
						response.HashAlgorithm = proto.Uint32(0)
					}
					if err := verifyReceiver(response, nonce, peer, pool, now); err == nil {
						t.Fatal("accepted invalid Cast certificate or challenge")
					}
				})
			}
		})
	}
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

func TestLegacySHA1ChallengeResponse(t *testing.T) {
	device, intermediate, _, key, roots := authFixture(t)
	nonce, peer := []byte("challenge nonce!"), []byte("TLS certificate DER")
	for _, scenario := range []string{"explicit SHA1", "default SHA1", "wrong nonce", "missing nonce", "changed TLS certificate", "bad signature", "untrusted", "expired", "unknown hash", "mismatched hash"} {
		t.Run(scenario, func(t *testing.T) {
			response := signedResponse(t, device, intermediate, key, nonce, peer)
			digest := sha1.Sum(append(append([]byte{}, nonce...), peer...))
			var err error
			response.Signature, err = rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA1, digest[:])
			if err != nil {
				t.Fatal(err)
			}
			response.HashAlgorithm = proto.Uint32(0)
			pool, now, peerDER := roots, time.Now(), peer
			switch scenario {
			case "default SHA1":
				response.HashAlgorithm = nil
			case "wrong nonce":
				response.SenderNonce = []byte("other nonce")
			case "missing nonce":
				response.SenderNonce = nil
			case "changed TLS certificate":
				peerDER = []byte("other TLS certificate")
			case "bad signature":
				response.Signature[0] ^= 1
			case "untrusted":
				pool = castRoots()
			case "expired":
				now = now.Add(48 * time.Hour)
			case "unknown hash":
				response.HashAlgorithm = proto.Uint32(2)
			case "mismatched hash":
				response.HashAlgorithm = proto.Uint32(1)
			}
			err = verifyReceiver(response, nonce, peerDER, pool, now)
			valid := scenario == "explicit SHA1" || scenario == "default SHA1"
			if (err == nil) != valid {
				t.Fatalf("unexpected legacy verification result: %v", err)
			}
		})
	}
}

func TestNonceLessLegacyChallengeResponse(t *testing.T) {
	device, intermediate, _, key, roots := authFixture(t)
	nonce, peer := []byte("fresh challenge nonce"), []byte("TLS certificate DER")
	for _, scenario := range []string{"valid", "changed TLS certificate", "bad signature", "untrusted", "expired", "wrong nonempty nonce"} {
		t.Run(scenario, func(t *testing.T) {
			response := signedResponse(t, device, intermediate, key, nil, peer)
			response.HashAlgorithm = nil
			digest := sha1.Sum(peer)
			var err error
			response.Signature, err = rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA1, digest[:])
			if err != nil {
				t.Fatal(err)
			}
			pool, now, peerDER := roots, time.Now(), peer
			switch scenario {
			case "changed TLS certificate":
				peerDER = []byte("other TLS certificate")
			case "bad signature":
				response.Signature[0] ^= 1
			case "untrusted":
				pool = castRoots()
			case "expired":
				now = now.Add(48 * time.Hour)
			case "wrong nonempty nonce":
				response.SenderNonce = []byte("other nonce")
			}
			err = verifyReceiver(response, nonce, peerDER, pool, now)
			if (err == nil) != (scenario == "valid") {
				t.Fatalf("unexpected nonce-less verification result: %v", err)
			}
		})
	}
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
	roots := testCastRoots(t, intermediate)
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
	if challenge.Challenge.HashAlgorithm == nil || *challenge.Challenge.HashAlgorithm != 1 {
		t.Fatal("challenge did not request SHA256")
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
