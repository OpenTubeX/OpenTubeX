package org.opentubex.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ChromecastTest {
    @Test public void androidDiscoversCastServicesWithoutGooglePlayServices() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NsdManager nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        NsdServiceInfo service = new NsdServiceInfo();
        service.setServiceName("OpenTubeX-Cast-Test");
        service.setServiceType("_googlecast._tcp.");
        service.setPort(8009);
        service.setAttribute("id", "otx-cast-test");
        service.setAttribute("fn", "Android test TV");
        service.setAttribute("ca", "1");
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
            JSArray devices = CastDiscovery.discover(context);
            boolean found = false;
            for (int index = 0; index < devices.length(); index++) {
                var device = devices.getJSONObject(index);
                if (!device.optString("id").equals("otx-cast-test")) continue;
                found = true;
                assertEquals("Android test TV", device.getString("name"));
                assertEquals(8009, device.getInt("port"));
                assertTrue(device.getString("address").matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}"));
            }
            assertTrue("Native Android NSD finds a Google Cast receiver", found);
        } finally { nsd.unregisterService(listener); }
    }

    @Test public void packagedSenderRunsAsTheAppAndRejectsAnUnauthenticatedPeer() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File executable = new File(context.getApplicationInfo().nativeLibraryDir, "libopentubex_cast.so");
        assertTrue("Sender is installed in the executable native library directory", executable.canExecute());
        try (ServerSocket peer = new ServerSocket(0)) {
            CompletableFuture<Integer> firstByte = new CompletableFuture<>();
            Thread responder = new Thread(() -> {
                try (var socket = peer.accept()) { firstByte.complete(socket.getInputStream().read()); }
                catch (Exception error) { firstByte.completeExceptionally(error); }
            });
            responder.start();
            try (CastTransport sender = new CastTransport(executable.getAbsolutePath(), "127.0.0.1", peer.getLocalPort(), event -> {})) {
                try { sender.connect(); fail("Unauthenticated receiver accepted"); }
                catch (Exception expected) { assertEquals("Cast transport starts with a TLS handshake", 22, (int) firstByte.get(5, TimeUnit.SECONDS)); }
            }
            responder.join(5000);
        }
    }

    @Test public void nativeRelayServesCaptionsAndWaitsForSharedManifestRewriting() throws Exception {
        AtomicReference<CastMediaServer> relay = new AtomicReference<>();
        try (CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null, event -> {
            assertEquals("application/dash+xml", event.getString("contentType"));
            assertEquals("<MPD/>", event.getString("body"));
            relay.get().complete(event.getString("requestId"), "<MPD><Period/></MPD>");
        })) {
            relay.set(server);
            JSArray resources = new JSArray();
            resources.put(resource(0, "data:text/vtt;charset=utf-8,WEBVTT%0A%0AA%2BB", "text/vtt"));
            resources.put(resource(1, "data:application/dash+xml,%3CMPD%2F%3E", "application/dash+xml"));
            server.register(resources);
            assertEquals("WEBVTT\n\nA+B", fetch(server.origin() + "/test-token/0/media", 200));
            assertEquals("<MPD><Period/></MPD>", fetch(server.origin() + "/test-token/1/media", 200));
            assertEquals("", fetch(server.origin() + "/wrong-token/0/media", 404));
            assertEquals("", fetch(server.origin() + "/test-token/0/other", 502));
        }
    }

    @Test public void rejectedControlDoesNotDisconnectTheNativeSender() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File fixture = new File(context.getCacheDir(), "cast-control-fixture.sh");
        String namespace = "urn:x-cast:com.google.cast.media";
        String status = "{\"type\":\"MEDIA_STATUS\",\"requestId\":%d,\"status\":[{\"mediaSessionId\":7,\"playerState\":\"PLAYING\",\"media\":{\"contentId\":\"http://media.test/video.mp4\"}}]}";
        String script = "echo '{\"event\":\"connected\",\"address\":\"127.0.0.1\"}'\n";
        for (int id = 1; id <= 3; id++) {
            String payload = id == 2 ? "{\"type\":\"INVALID_REQUEST\",\"requestId\":2}" : String.format(java.util.Locale.ROOT, status, id);
            script += "read -r command\necho '{\"event\":\"message\",\"namespace\":\"" + namespace + "\",\"payload\":" + payload + "}'\n";
        }
        script += "read -r command\n";
        try {
            java.nio.file.Files.write(fixture.toPath(), script.getBytes(StandardCharsets.UTF_8));
            try (CastTransport sender = new CastTransport("/system/bin/sh", fixture.getAbsolutePath(), 0, event -> {})) {
                sender.connect();
                sender.send(namespace, "transport", new JSObject().put("type", "LOAD")
                    .put("media", new JSObject().put("contentId", "http://media.test/video.mp4")), true);
                try { sender.send(namespace, "transport", new JSObject().put("type", "SEEK"), true); fail("Receiver rejected the control"); }
                catch (Exception expected) { assertTrue("Report the receiver rejection", expected.getMessage().contains("INVALID_REQUEST")); }
                JSObject response = sender.send(namespace, "transport", new JSObject().put("type", "GET_STATUS"), true);
                assertEquals("PLAYING", response.getJSONArray("status").getJSONObject(0).getString("playerState"));
            }
        } finally { fixture.delete(); }
    }

    @Test public void relayForwardsOnlyValidHlsReloadParametersAndPreservesSignedQuery() throws Exception {
        LinkedBlockingQueue<String> requests = new LinkedBlockingQueue<>();
        CompletableFuture<Void> served = new CompletableFuture<>();
        AtomicReference<CastMediaServer> relay = new AtomicReference<>();
        try (ServerSocket upstream = new ServerSocket(0);
             CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null,
                 event -> relay.get().complete(event.getString("requestId"), event.getString("body")))) {
            relay.set(server);
            Thread responder = new Thread(() -> {
                try {
                    for (int index = 0; index < 2; index++) {
                        try (Socket socket = upstream.accept()) {
                            var input = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                            requests.add(input.readLine());
                            for (String line; (line = input.readLine()) != null && !line.isEmpty();) {}
                            byte[] body = "#EXTM3U\n".getBytes(StandardCharsets.UTF_8);
                            socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: application/x-mpegurl\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                            socket.getOutputStream().write(body);
                        }
                    }
                    served.complete(null);
                } catch (Exception error) { served.completeExceptionally(error); }
            });
            responder.setDaemon(true);
            responder.start();
            JSArray resources = new JSArray();
            resources.put(resource(0, "http://127.0.0.1:" + upstream.getLocalPort() + "/live.m3u8?token=a%2fb&dup=a&dup=b&_HLS_msn=1", "application/x-mpegurl"));
            server.register(resources);
            assertEquals("#EXTM3U\n", fetch(server.origin() + "/test-token/0/media", 200));
            assertEquals("GET /live.m3u8?token=a%2fb&dup=a&dup=b&_HLS_msn=1 HTTP/1.1", requests.poll(3, TimeUnit.SECONDS));
            assertEquals("#EXTM3U\n", fetch(server.origin() + "/test-token/0/media?_HLS_msn=123&_HLS_part=0&_HLS_skip=v2", 200));
            assertEquals("GET /live.m3u8?token=a%2fb&dup=a&dup=b&_HLS_msn=123&_HLS_part=0&_HLS_skip=v2 HTTP/1.1", requests.poll(3, TimeUnit.SECONDS));
            served.get(3, TimeUnit.SECONDS);
            for (String query : new String[]{"token=changed", "_HLS_msn=1&_HLS_msn=2", "_HLS_msn=-1", "_HLS_skip=invalid"}) {
                assertEquals("", fetch(server.origin() + "/test-token/0/media?" + query, 502));
            }
        }
    }

    @Test public void relayServesDashRequestsWhileOtherRepresentationsAreStillOpen() throws Exception {
        // DASH demuxers keep each representation open while probing the next one.
        CountDownLatch opened = new CountDownLatch(8);
        CountDownLatch release = new CountDownLatch(1);
        var connections = new ArrayList<Socket>();
        try (CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null, event -> {
            opened.countDown();
            try { release.await(5, TimeUnit.SECONDS); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        })) {
            JSArray resources = new JSArray();
            resources.put(resource(0, "data:application/dash+xml,%3CMPD%2F%3E", "application/dash+xml"));
            resources.put(resource(1, "data:text/vtt;charset=utf-8,WEBVTT", "text/vtt"));
            server.register(resources);
            try {
                for (int index = 0; index < 8; index++) {
                    Socket socket = new Socket("127.0.0.1", new URL(server.origin()).getPort());
                    connections.add(socket);
                    socket.getOutputStream().write(("GET /test-token/0/media HTTP/1.1\r\nHost: localhost\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                }
                assertTrue("Eight representation requests are in progress", opened.await(3, TimeUnit.SECONDS));
                assertEquals("WEBVTT", fetch(server.origin() + "/test-token/1/media", 200));
            } finally {
                release.countDown();
                for (Socket socket : connections) socket.close();
            }
        }
    }

    @Test public void relayPinsTheReceiverAndRejectsTemplateTraversal() throws Exception {
        try (CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null, event -> {})) {
            JSArray candidates = new JSArray();
            candidates.put(new JSObject().put("url", "http://127.0.0.1:1/media/").put("template", true));
            JSArray resources = new JSArray();
            resources.put(new JSObject().put("id", 0).put("candidates", candidates));
            server.register(resources);
            assertEquals("", fetch(server.origin() + "/test-token/0/%252e%252e/private", 502));
        }
        try (CastMediaServer server = new CastMediaServer("127.0.0.1", "192.0.2.1", "test-token", null, event -> {})) {
            try { fetch(server.origin() + "/test-token/0/media", 200); fail("Other clients must not access the relay"); }
            catch (java.io.IOException expected) {}
        }
    }

    @Test public void prepareOpenSourceReceiverForUiTest() throws Exception {
        var arguments = InstrumentationRegistry.getArguments();
        org.junit.Assume.assumeTrue(arguments.containsKey("castEmulatorPort"));
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File ready = new File(context.getCacheDir(), "cast-emulator-ready");
        File finished = new File(context.getCacheDir(), "cast-emulator-finished");
        ready.delete(); finished.delete();
        try (var scenario = androidx.test.core.app.ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                try {
                    var plugin = activity.getBridge().getPlugin("Chromecast").getInstance();
                    var field = ChromecastPlugin.class.getDeclaredField("devices");
                    field.setAccessible(true);
                    @SuppressWarnings("unchecked")
                    var devices = (java.util.Map<String, JSObject>) field.get(plugin);
                    // Emulator loopback uses adb reverse to reach the unmodified
                    // openchromecast receiver; Android NSD is tested separately.
                    devices.put("open-source-emulator", new JSObject().put("id", "open-source-emulator")
                        .put("name", "OpenTubeX Test Receiver").put("address", "127.0.0.1")
                        .put("port", Integer.parseInt(arguments.getString("castEmulatorPort"))));
                    ready.createNewFile();
                } catch (Exception error) { throw new RuntimeException(error); }
            });
            long deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(5);
            while (!finished.exists() && System.nanoTime() < deadline) Thread.sleep(100);
            assertTrue("External UI integration test completed", finished.exists());
        } finally { ready.delete(); finished.delete(); }
    }

    private static JSObject resource(int id, String url, String type) {
        JSArray candidates = new JSArray();
        candidates.put(new JSObject().put("url", url));
        return new JSObject().put("id", id).put("contentType", type).put("candidates", candidates);
    }

    private static String fetch(String url, int expectedStatus) throws Exception {
        HttpURLConnection request = (HttpURLConnection) new URL(url).openConnection(java.net.Proxy.NO_PROXY);
        request.setConnectTimeout(3000);
        request.setReadTimeout(5000);
        try {
            assertEquals(expectedStatus, request.getResponseCode());
            if (expectedStatus != 200) return "";
            assertEquals("*", request.getHeaderField("Access-Control-Allow-Origin"));
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (InputStream input = request.getInputStream()) {
                byte[] buffer = new byte[4096];
                for (int count; (count = input.read(buffer)) != -1;) output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        } finally { request.disconnect(); }
    }
}
