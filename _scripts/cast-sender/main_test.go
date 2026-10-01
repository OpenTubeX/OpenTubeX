package main

import (
	"encoding/binary"
	"encoding/json"
	"net"
	"sync"
	"testing"
)

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
