package main

import (
	"bytes"
	"compress/gzip"
	"crypto/tls"
	"encoding/json"
	"encoding/pem"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func TestVerifiedTLSAndCookies(t *testing.T) {
	t.Setenv("https_proxy", "")
	t.Setenv("SSL_CERT_FILE", "")
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.UserAgent() != "Chrome/150.0 test" || len(r.Header.Values("User-Agent")) != 1 || r.Header.Get("Cookie") != "session=fixture" {
			t.Error("Chrome headers and yt-dlp cookies were not forwarded")
		}
		w.Header().Add("Set-Cookie", "first=1; Path=/")
		w.Header().Add("Set-Cookie", "second=2; Path=/")
		w.Header().Set("Content-Encoding", "gzip")
		writer := gzip.NewWriter(w)
		writer.Write([]byte("metadata"))
		writer.Close()
	}))
	server.EnableHTTP2 = true
	server.TLS = &tls.Config{GetConfigForClient: func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
		if !slices.Contains(hello.SignatureSchemes, tls.SignatureScheme(0x0904)) || !slices.Contains(hello.SupportedProtos, "h2") {
			t.Error("Chrome 150 TLS fingerprint was lost through the relay")
		}
		return nil, nil
	}}
	server.StartTLS()
	defer server.Close()
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "CONNECT" {
			t.Error("HTTPS request did not use the relay tunnel")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		upstream, err := net.DialTimeout("tcp", r.Host, time.Second)
		if err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		defer upstream.Close()
		client, buffer, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer client.Close()
		buffer.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n")
		buffer.Flush()
		go func() { io.Copy(upstream, buffer); upstream.Close() }()
		io.Copy(client, upstream)
	}))
	defer relay.Close()
	t.Setenv("https_proxy", relay.URL)
	input, _ := json.Marshal(request{URL: server.URL, Method: "GET", Headers: map[string]string{"cookie": "session=fixture", "user-agent": "Chrome/150.0 test"}, Timeout: 1000})
	var output bytes.Buffer
	if err := run(bytes.NewReader(input), &output); err == nil {
		t.Fatal("Untrusted TLS certificate was accepted")
	}
	certificate := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(certificate, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SSL_CERT_FILE", certificate)
	if err := run(bytes.NewReader(input), &output); err != nil {
		t.Fatal(err)
	}
	var result response
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != 200 || string(result.Body) != "metadata" || len(result.Headers["Set-Cookie"]) != 2 {
		t.Fatalf("TLS response lost metadata, decompression or cookies: %+v", result)
	}
}

func TestRedirectsRemainOwnedByYtDlp(t *testing.T) {
	t.Setenv("https_proxy", "")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "https://rumble.com/next")
		w.WriteHeader(http.StatusFound)
	}))
	defer server.Close()
	input, _ := json.Marshal(request{URL: server.URL, Method: "GET", Timeout: 1000})
	var output bytes.Buffer
	if err := run(bytes.NewReader(input), &output); err != nil {
		t.Fatal(err)
	}
	var result response
	json.Unmarshal(output.Bytes(), &result)
	if result.Status != 302 || result.Headers["Location"][0] != "https://rumble.com/next" {
		t.Fatal("Native helper followed a redirect without yt-dlp's cookie policy")
	}
}

func TestFailedProxyCannotFallBackToDirect(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests++ }))
	defer server.Close()
	t.Setenv("https_proxy", "http://127.0.0.1:1")
	input, _ := json.Marshal(request{URL: server.URL, Method: "GET", Timeout: 1000})
	if err := run(bytes.NewReader(input), &bytes.Buffer{}); err == nil || requests != 0 {
		t.Fatal("Failed proxy must not fall back to a direct request")
	}
}
