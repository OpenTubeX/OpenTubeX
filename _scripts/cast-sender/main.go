// A packaged bridge to go-chromecast. Electron owns the media session; this
// process handles mDNS and the Cast V2 transport without a system runtime.
package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gogo/protobuf/proto"
	"github.com/grandcat/zeroconf"
	pb "github.com/vishen/go-chromecast/cast/proto"
)

type device struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Address string `json:"address"`
	Port    int    `json:"port"`
}

func discover() error {
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	entries := make(chan *zeroconf.ServiceEntry)
	devices := map[string]device{}
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for entry := range entries {
			fields := map[string]string{}
			for _, field := range entry.Text {
				for i, char := range field {
					if char == '=' {
						fields[field[:i]] = field[i+1:]
						break
					}
				}
			}
			capabilities, _ := strconv.Atoi(fields["ca"])
			if fields["id"] == "" || fields["fn"] == "" || capabilities&1 == 0 || len(entry.AddrIPv4) == 0 {
				continue
			}
			devices[fields["id"]] = device{fields["id"], fields["fn"], entry.AddrIPv4[0].String(), entry.Port}
		}
	}()
	if err := resolver.Browse(ctx, "_googlecast._tcp", "local.", entries); err != nil {
		cancel()
		return err
	}
	<-ctx.Done()
	wg.Wait()
	result := []device{}
	for _, value := range devices {
		result = append(result, value)
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}

// Frames must be written atomically: receiver heartbeats arrive independently
// of Electron commands. Use go-chromecast's protocol definitions with our own
// bounded framing and correctly addressed heartbeat responses.
type transport struct {
	connection net.Conn
	writeMutex sync.Mutex
}

func (t *transport) send(source, destination, namespace string, payload interface{}) error {
	value, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	text := string(value)
	message := &pb.CastMessage{
		ProtocolVersion: pb.CastMessage_CASTV2_1_0.Enum(),
		SourceId:        &source, DestinationId: &destination, Namespace: &namespace,
		PayloadType: pb.CastMessage_STRING.Enum(), PayloadUtf8: &text,
	}
	return t.writeMessage(message)
}

func (t *transport) writeMessage(message *pb.CastMessage) error {
	data, err := proto.Marshal(message)
	if err != nil {
		return err
	}
	frame := make([]byte, len(data)+4)
	binary.BigEndian.PutUint32(frame, uint32(len(data)))
	copy(frame[4:], data)
	t.writeMutex.Lock()
	defer t.writeMutex.Unlock()
	if err := t.connection.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return err
	}
	for len(frame) > 0 {
		count, err := t.connection.Write(frame)
		if err != nil {
			return err
		}
		if count == 0 {
			return io.ErrUnexpectedEOF
		}
		frame = frame[count:]
	}
	return nil
}

func (t *transport) receive() (*pb.CastMessage, error) {
	return t.receiveBefore(time.Now().Add(30 * time.Second))
}

func (t *transport) receiveBefore(deadline time.Time) (*pb.CastMessage, error) {
	if err := t.connection.SetReadDeadline(deadline); err != nil {
		return nil, err
	}
	var length uint32
	if err := binary.Read(t.connection, binary.BigEndian, &length); err != nil {
		return nil, err
	}
	if length == 0 || length > 1024*1024 {
		return nil, fmt.Errorf("invalid Cast frame length")
	}
	data := make([]byte, length)
	if _, err := io.ReadFull(t.connection, data); err != nil {
		return nil, err
	}
	message := &pb.CastMessage{}
	if err := proto.Unmarshal(data, message); err != nil {
		return nil, err
	}
	if message.GetNamespace() == "urn:x-cast:com.google.cast.tp.heartbeat" {
		var heartbeat struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal([]byte(message.GetPayloadUtf8()), &heartbeat); err != nil {
			return nil, err
		}
		if heartbeat.Type == "PING" {
			if err := t.send(message.GetDestinationId(), message.GetSourceId(), message.GetNamespace(), map[string]string{"type": "PONG"}); err != nil {
				return nil, err
			}
		}
	}
	return message, nil
}

func connect(address string, port int) error {
	if net.ParseIP(address) == nil || port < 1 || port > 65535 {
		return fmt.Errorf("invalid Cast address")
	}
	// Cast uses self-signed TLS; device authentication below binds its certificate
	// to a Google-signed device identity before any session data can be sent.
	connection, err := tls.DialWithDialer(&net.Dialer{Timeout: 3 * time.Second}, "tcp", net.JoinHostPort(address, strconv.Itoa(port)), &tls.Config{InsecureSkipVerify: true})
	if err != nil {
		return err
	}
	defer connection.Close()
	channel := &transport{connection: connection}
	if err := authenticateReceiver(channel, connection.ConnectionState().PeerCertificates[0], castRoots()); err != nil {
		return err
	}
	localAddress, _, err := net.SplitHostPort(connection.LocalAddr().String())
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(os.Stdout)
	if err := encoder.Encode(map[string]interface{}{"event": "connected", "address": localAddress}); err != nil {
		return err
	}
	go func() {
		for {
			message, err := channel.receive()
			if err != nil {
				os.Exit(1)
			}
			var value json.RawMessage = []byte(message.GetPayloadUtf8())
			if json.Valid(value) {
				if err := encoder.Encode(map[string]interface{}{"event": "message", "namespace": message.GetNamespace(), "payload": value}); err != nil {
					os.Exit(1)
				}
			}
		}
	}()
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	for scanner.Scan() {
		var command struct {
			ID          int                    `json:"id"`
			Namespace   string                 `json:"namespace"`
			Destination string                 `json:"destination"`
			Payload     map[string]interface{} `json:"payload"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &command); err != nil {
			return err
		}
		if command.Payload == nil {
			return fmt.Errorf("missing Cast payload")
		}
		command.Payload["requestId"] = command.ID
		if err := channel.send("sender-0", command.Destination, command.Namespace, command.Payload); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func main() {
	var err error
	if len(os.Args) == 2 && os.Args[1] == "discover" {
		err = discover()
	} else if len(os.Args) == 3 {
		port, parseErr := strconv.Atoi(os.Args[2])
		if parseErr != nil {
			err = parseErr
		} else {
			err = connect(os.Args[1], port)
		}
	} else {
		err = fmt.Errorf("expected discover or address and port")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
