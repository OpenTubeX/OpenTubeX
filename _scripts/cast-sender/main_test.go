package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/json"
	"io"
	"math/big"
	"net"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"
)

func TestConnectRejectsUnauthenticatedReceiver(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Untrusted TV"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		connection, err := listener.Accept()
		if err != nil {
			return
		}
		defer connection.Close()
		_ = connection.(*tls.Conn).Handshake()
		// Close without answering device authentication.
	}()
	address, port, _ := net.SplitHostPort(listener.Addr().String())
	portNumber, _ := strconv.Atoi(port)
	output, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer output.Close()
	originalOutput := os.Stdout
	os.Stdout = writer
	defer func() { os.Stdout = originalOutput; writer.Close() }()
	if err := connect(address, portNumber); err == nil {
		t.Fatal("connected to a receiver that never authenticated")
	}
	os.Stdout = originalOutput
	writer.Close()
	events, err := io.ReadAll(output)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 0 {
		t.Fatalf("emitted session events before authentication: %s", events)
	}
}

func TestHeartbeatAddresses(t *testing.T) {
	left, right := net.Pipe()
	defer left.Close()
	defer right.Close()
	client, receiver := &transport{connection: left}, &transport{connection: right}
	errCh := make(chan error, 1)
	go func() { _, err := client.receive(); errCh <- err }()
	namespace := "urn:x-cast:com.google.cast.tp.heartbeat"
	if err := receiver.send("receiver-0", "sender-0", namespace, map[string]string{"type": "PING"}); err != nil {
		t.Fatal(err)
	}
	message, err := receiver.receive()
	if err != nil {
		t.Fatal(err)
	}
	if message.GetSourceId() != "sender-0" || message.GetDestinationId() != "receiver-0" || message.GetNamespace() != namespace {
		t.Fatalf("incorrect heartbeat response: %v", message)
	}
	var response struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal([]byte(message.GetPayloadUtf8()), &response); err != nil {
		t.Fatal(err)
	}
	if response.Type != "PONG" {
		t.Fatalf("expected PONG, got %s", response.Type)
	}
	if err := <-errCh; err != nil {
		t.Fatal(err)
	}
}

func TestConcurrentFrames(t *testing.T) {
	left, right := net.Pipe()
	defer left.Close()
	defer right.Close()
	client, receiver := &transport{connection: left}, &transport{connection: right}
	const count = 40
	var writers sync.WaitGroup
	errors := make(chan error, count)
	for i := range count {
		writers.Add(1)
		go func(id int) {
			defer writers.Done()
			errors <- client.send("sender-0", "receiver-0", "urn:x-cast:com.google.cast.receiver", map[string]interface{}{"type": "GET_STATUS", "requestId": id})
		}(i)
	}
	ids := map[int]bool{}
	for range count {
		message, err := receiver.receive()
		if err != nil {
			t.Fatal(err)
		}
		var command struct {
			RequestID int `json:"requestId"`
		}
		if err := json.Unmarshal([]byte(message.GetPayloadUtf8()), &command); err != nil {
			t.Fatal(err)
		}
		if ids[command.RequestID] {
			t.Fatal("duplicate message")
		}
		ids[command.RequestID] = true
	}
	writers.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestRejectsUnboundedFrames(t *testing.T) {
	for _, length := range []uint32{0, 1024*1024 + 1} {
		left, right := net.Pipe()
		go func() { _ = binary.Write(right, binary.BigEndian, length); right.Close() }()
		if _, err := (&transport{connection: left}).receive(); err == nil {
			t.Fatal("expected invalid frame error")
		}
		left.Close()
	}
}
