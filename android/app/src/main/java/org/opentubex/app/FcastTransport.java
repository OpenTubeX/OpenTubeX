package org.opentubex.app;

import com.getcapacitor.JSObject;
import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/** FCast v3 over TCP: a little-endian size, an opcode and a JSON body. The shared JS session handles the protocol. */
final class FcastTransport implements CastConnection {
    static final int MAX_SENT_PACKET = 32_000;
    // Receivers may relay large play messages from other senders.
    private static final int MAX_RECEIVED_PACKET = 512 * 1024;
    private final Socket socket = new Socket();
    private final String address;
    private final int port;
    private final Consumer<JSObject> events;
    private final Object writes = new Object();
    private final AtomicBoolean closed = new AtomicBoolean();
    private OutputStream output;

    FcastTransport(String address, int port, Consumer<JSObject> events) {
        this.address = address;
        this.port = port;
        this.events = events;
    }

    String connect() throws Exception {
        try {
            socket.connect(new InetSocketAddress(InetAddress.getByName(address), port), 5000);
            socket.setTcpNoDelay(true);
            output = socket.getOutputStream();
        } catch (IOException error) {
            close();
            throw new CastTransport.Failure("FCast receiver did not respond", "CAST_TIMEOUT");
        }
        Thread reader = new Thread(this::read, "OpenTubeX FCast reader");
        reader.setDaemon(true);
        reader.start();
        return socket.getLocalAddress().getHostAddress();
    }

    private void read() {
        try (DataInputStream input = new DataInputStream(new BufferedInputStream(socket.getInputStream()))) {
            byte[] header = new byte[4];
            while (!closed.get()) {
                input.readFully(header);
                int size = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN).getInt();
                if (size < 1 || size > MAX_RECEIVED_PACKET) return;
                int opcode = input.readUnsignedByte();
                byte[] body = new byte[size - 1];
                input.readFully(body);
                JSObject event = new JSObject().put("event", "packet").put("opcode", opcode);
                if (body.length > 0) event.put("body", new JSObject(new String(body, StandardCharsets.UTF_8)));
                events.accept(event);
            }
        } catch (Exception ignored) { /* A closed or malformed stream ends the session. */ }
        finally { close(); }
    }

    void send(int opcode, JSObject body) throws Exception {
        byte[] data = body == null ? new byte[0] : body.toString().getBytes(StandardCharsets.UTF_8);
        if (data.length + 1 > MAX_SENT_PACKET) throw new IllegalArgumentException("FCast message is too large");
        byte[] packet = ByteBuffer.allocate(data.length + 5).order(ByteOrder.LITTLE_ENDIAN)
            .putInt(data.length + 1).put((byte) opcode).put(data).array();
        synchronized (writes) {
            if (closed.get()) throw new CastTransport.Failure("FCast receiver disconnected", "CAST_DISCONNECTED");
            try {
                output.write(packet);
                output.flush();
            } catch (IOException error) {
                close();
                throw new CastTransport.Failure("FCast receiver disconnected", "CAST_DISCONNECTED");
            }
        }
    }

    @Override public String localAddress() { return socket.getLocalAddress().getHostAddress(); }

    @Override public void stopMedia() {
        try { send(4, null); } catch (Exception ignored) { /* Preserve teardown on disconnect. */ }
    }

    @Override public void close() {
        if (!closed.compareAndSet(false, true)) return;
        try { socket.close(); } catch (IOException ignored) { /* Already closed. */ }
        events.accept(new JSObject().put("event", "closed"));
    }
}
