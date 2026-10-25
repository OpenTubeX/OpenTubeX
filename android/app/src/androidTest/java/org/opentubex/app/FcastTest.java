package org.opentubex.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.DataInputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class FcastTest {
    private static byte[] packet(int opcode, String body) {
        byte[] data = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
        return ByteBuffer.allocate(data.length + 5).order(ByteOrder.LITTLE_ENDIAN).putInt(data.length + 1).put((byte) opcode).put(data).array();
    }

    @Test public void transportExchangesFramedPacketsUntilTheReceiverCloses() throws Exception {
        try (ServerSocket receiver = new ServerSocket(0)) {
            CompletableFuture<String> received = new CompletableFuture<>();
            Thread peer = new Thread(() -> {
                try (Socket socket = receiver.accept()) {
                    OutputStream output = socket.getOutputStream();
                    output.write(packet(11, "{\"version\":3}"));
                    output.write(packet(12, null));
                    output.flush();
                    DataInputStream input = new DataInputStream(socket.getInputStream());
                    byte[] header = new byte[5];
                    input.readFully(header);
                    int size = ByteBuffer.wrap(header, 0, 4).order(ByteOrder.LITTLE_ENDIAN).getInt();
                    byte[] body = new byte[size - 1];
                    input.readFully(body);
                    received.complete(header[4] + ":" + new String(body, StandardCharsets.UTF_8));
                } catch (Exception error) { received.completeExceptionally(error); }
            });
            peer.start();
            var events = new LinkedBlockingQueue<JSObject>();
            try (FcastTransport transport = new FcastTransport("127.0.0.1", receiver.getLocalPort(), events::add)) {
                assertEquals("127.0.0.1", transport.connect());
                transport.send(11, new JSObject().put("version", 3));
                assertEquals("11:{\"version\":3}", received.get(5, TimeUnit.SECONDS));
                JSObject version = events.poll(5, TimeUnit.SECONDS);
                assertEquals("packet", version.getString("event"));
                assertEquals(11, version.getInt("opcode"));
                assertEquals(3, version.getJSObject("body").getInt("version"));
                JSObject ping = events.poll(5, TimeUnit.SECONDS);
                assertEquals(12, ping.getInt("opcode"));
                assertFalse("Empty bodies are omitted", ping.has("body"));
                assertEquals("closed", events.poll(5, TimeUnit.SECONDS).getString("event"));
                try { transport.send(2, null); fail("A closed connection must reject commands"); }
                catch (CastTransport.Failure expected) { assertEquals("CAST_DISCONNECTED", expected.code); }
            }
            peer.join(5000);
        }
    }

    @Test public void transportClosesOnOversizedReceiverPackets() throws Exception {
        try (ServerSocket receiver = new ServerSocket(0)) {
            Thread peer = new Thread(() -> {
                try (Socket socket = receiver.accept()) {
                    socket.getOutputStream().write(ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(512 * 1024 + 1).array());
                    socket.getInputStream().read();
                } catch (Exception ignored) { /* The sender closes the connection. */ }
            });
            peer.start();
            var events = new LinkedBlockingQueue<JSObject>();
            try (FcastTransport transport = new FcastTransport("127.0.0.1", receiver.getLocalPort(), events::add)) {
                transport.connect();
                assertEquals("closed", events.poll(5, TimeUnit.SECONDS).getString("event"));
            }
            peer.join(5000);
        }
    }

    @Test public void unreachableReceiverReportsATimeout() throws Exception {
        int port;
        try (ServerSocket closed = new ServerSocket(0)) { port = closed.getLocalPort(); }
        try (FcastTransport transport = new FcastTransport("127.0.0.1", port, event -> {})) {
            transport.connect();
            fail("Connection must fail");
        } catch (CastTransport.Failure expected) { assertEquals("CAST_TIMEOUT", expected.code); }
        try (FcastTransport transport = new FcastTransport("127.0.0.1", port, event -> {})) {
            assertThrows(IllegalArgumentException.class, () -> transport.send(1, new JSObject().put("url", new String(new char[FcastTransport.MAX_SENT_PACKET]).replace('\0', 'x'))));
        }
    }

    @Test public void serviceNamesDecodePresentationEscapes() {
        assertEquals("Living Room.TV é", CastDiscovery.unescapeLabel("Living\\032Room\\.TV \\195\\169"));
        assertEquals("Plain", CastDiscovery.unescapeLabel("Plain"));
    }

    @Test public void androidDiscoversFcastReceiversByInstanceName() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NsdManager nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        NsdServiceInfo service = new NsdServiceInfo();
        service.setServiceName("OpenTubeX FCast Test");
        service.setServiceType("_fcast._tcp.");
        service.setPort(46899);
        service.setAttribute("v", "4");
        CompletableFuture<Void> registered = new CompletableFuture<>();
        NsdManager.RegistrationListener listener = new NsdManager.RegistrationListener() {
            @Override public void onServiceRegistered(NsdServiceInfo value) { registered.complete(null); }
            @Override public void onRegistrationFailed(NsdServiceInfo value, int code) { registered.completeExceptionally(new IllegalStateException("Registration failed: " + code)); }
            @Override public void onServiceUnregistered(NsdServiceInfo value) {}
            @Override public void onUnregistrationFailed(NsdServiceInfo value, int code) {}
        };
        nsd.registerService(service, NsdManager.PROTOCOL_DNS_SD, listener);
        try {
            registered.get(5, TimeUnit.SECONDS);
            JSArray devices = CastDiscovery.discover(context, true);
            boolean found = false;
            for (int index = 0; index < devices.length(); index++) {
                var device = devices.getJSONObject(index);
                if (!device.optString("id").equals("OpenTubeX FCast Test")) continue;
                found = true;
                assertEquals("OpenTubeX FCast Test", device.getString("name"));
                assertEquals(46899, device.getInt("port"));
                assertTrue(device.getString("address").matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}"));
            }
            assertTrue("Native Android NSD finds an FCast receiver", found);
            JSArray googleCast = CastDiscovery.discover(context);
            for (int index = 0; index < googleCast.length(); index++) {
                assertNotEquals("Google Cast discovery ignores FCast receivers", "OpenTubeX FCast Test", googleCast.getJSONObject(index).optString("name"));
            }
        } finally { nsd.unregisterService(listener); }
    }
}
