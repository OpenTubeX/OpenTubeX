package main

import (
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/imroc/req/v3"
	"github.com/imroc/req/v3/http2"
	utls "github.com/refraction-networking/utls"
)

const maxBody = 16 * 1024 * 1024

func chromeHello() utls.ClientHelloSpec {
	spec, err := utls.UTLSIdToSpec(utls.HelloChrome_133)
	if err != nil {
		panic(err)
	}
	// Chrome 150 adds the ML-DSA signature algorithms to the Chrome 133 hello.
	for _, extension := range spec.Extensions {
		if algorithms, ok := extension.(*utls.SignatureAlgorithmsExtension); ok {
			algorithms.SupportedSignatureAlgorithms = append([]utls.SignatureScheme{0x0904, 0x0905, 0x0906}, algorithms.SupportedSignatureAlgorithms...)
		}
	}
	return spec
}

type request struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	Body    []byte            `json:"body"`
	Timeout int               `json:"timeout"`
}

type response struct {
	Status  int                 `json:"status"`
	Headers map[string][]string `json:"headers"`
	Body    []byte              `json:"body"`
}

// One bounded request per invocation. yt-dlp owns redirects and its cookie jar;
// the Android app's relay remains responsible for every network connection.
func run(input io.Reader, output io.Writer) error {
	var data request
	if err := json.NewDecoder(io.LimitReader(input, maxBody)).Decode(&data); err != nil {
		return err
	}
	if data.Timeout < 1 || data.Timeout > 60000 {
		return fmt.Errorf("invalid HTTP timeout")
	}
	// Match Chrome's TLS handshake, HTTP/2 settings and pseudo-header order.
	client := req.C().SetTLSFingerprintSpec(chromeHello).
		SetHTTP2SettingsFrame(
			http2.Setting{ID: http2.SettingHeaderTableSize, Val: 65536},
			http2.Setting{ID: http2.SettingEnablePush, Val: 0},
			http2.Setting{ID: http2.SettingInitialWindowSize, Val: 6291456},
			http2.Setting{ID: http2.SettingMaxHeaderListSize, Val: 262144}).
		SetHTTP2ConnectionFlow(15663105).
		SetCommonPseudoHeaderOder(":method", ":authority", ":scheme", ":path").
		SetTimeout(time.Duration(data.Timeout) * time.Millisecond).
		SetRedirectPolicy(req.NoRedirectPolicy()).SetCookieJar(nil).DisableAutoReadResponse()
	defer client.GetClient().CloseIdleConnections()
	var proxy *url.URL
	if value := os.Getenv("https_proxy"); value != "" {
		var err error
		proxy, err = url.Parse(value)
		if err != nil || proxy.Scheme != "http" || proxy.Host == "" {
			return fmt.Errorf("invalid Android network relay")
		}
	}
	client.SetProxy(func(*http.Request) (*url.URL, error) { return proxy, nil })
	if path := os.Getenv("SSL_CERT_FILE"); path != "" {
		pem, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		roots := x509.NewCertPool()
		if !roots.AppendCertsFromPEM(pem) {
			return fmt.Errorf("invalid CA certificate bundle")
		}
		client.GetTLSClientConfig().RootCAs = roots
	}
	headers := map[string]string{
		"User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
		"Accept":          "*/*",
		"Accept-Language": "en-US,en;q=0.9",
	}
	for name, value := range data.Headers {
		// Let the transport negotiate and decompress gzip itself.
		if !strings.EqualFold(name, "Accept-Encoding") {
			headers[http.CanonicalHeaderKey(name)] = value
		}
	}
	request := client.R().SetHeaderOrder("accept", "accept-language", "user-agent", "referer", "cookie").SetHeaders(headers)
	if data.Body != nil {
		request.SetBodyBytes(data.Body)
	}
	resp, err := request.Send(data.Method, data.URL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return err
	}
	if len(body) > maxBody {
		return fmt.Errorf("Rumble response exceeds metadata limit")
	}
	return json.NewEncoder(output).Encode(response{resp.StatusCode, resp.Header, body})
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
