package org.opentubex.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
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
    @Test public void relayCannotFetchLoopbackServices() throws Exception {
        try (ServerSocket upstream = new ServerSocket(0);
             CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null, event -> {})) {
            upstream.setSoTimeout(1000);
            CompletableFuture<Boolean> contacted = new CompletableFuture<>();
            Thread responder = new Thread(() -> {
                try (Socket socket = upstream.accept()) {
                    contacted.complete(true);
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                } catch (java.net.SocketTimeoutException expected) { contacted.complete(false); }
                catch (Exception error) { contacted.completeExceptionally(error); }
            });
            responder.start();
            JSArray resources = new JSArray();
            resources.put(resource(0, "http://127.0.0.1:" + upstream.getLocalPort() + "/private", "video/mp4"));
            server.register(resources);
            fetch(server.origin() + "/test-token/0/media", 502);
            assertFalse("No connection to the local service", contacted.get(2, TimeUnit.SECONDS));
        }
    }

    @Test public void manifestHandlersLeaveTheBridgeThreadAndDoNotWaitForControl() throws Exception {
        ChromecastPlugin plugin = new ChromecastPlugin();
        var field = ChromecastPlugin.class.getDeclaredField("worker");
        field.setAccessible(true);
        var control = (java.util.concurrent.ExecutorService) field.get(plugin);
        CountDownLatch release = new CountDownLatch(1);
        control.execute(() -> {
            try { release.await(); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        });
        try {
            long caller = Thread.currentThread().getId();
            RecordingCall registration = new RecordingCall("registerResources");
            plugin.registerResources(registration);
            assertNotEquals("Registration is dispatched even while control waits for LOAD", caller,
                (long) registration.completed.get(2, TimeUnit.SECONDS));
            RecordingCall completion = new RecordingCall("completeManifest");
            plugin.completeManifest(completion);
            assertNotEquals("Manifest completion is dispatched independently of LOAD", caller,
                (long) completion.completed.get(2, TimeUnit.SECONDS));
        } finally {
            release.countDown();
            for (var executor : ChromecastPlugin.class.getDeclaredFields()) {
                if (java.util.concurrent.ExecutorService.class.isAssignableFrom(executor.getType())) {
                    executor.setAccessible(true);
                    ((java.util.concurrent.ExecutorService) executor.get(plugin)).shutdownNow();
                }
            }
        }
    }

    private static final class RecordingCall extends PluginCall {
        final CompletableFuture<Long> completed = new CompletableFuture<>();
        RecordingCall(String method) { super(null, "Chromecast", "test", method, new JSObject()); }
        @Override public void resolve() { completed.complete(Thread.currentThread().getId()); }
        @Override public void reject(String message, String code, Exception error, JSObject data) {
            completed.complete(Thread.currentThread().getId());
        }
    }

    @Test public void discoveryReleasesMulticastLockAfterFailure() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context failing = new android.content.ContextWrapper(context) {
            @Override public Object getSystemService(String name) {
                if (Context.NSD_SERVICE.equals(name)) {
                    assertTrue("Hold multicast reception before browsing", wifiDump().contains("OpenTubeX Cast discovery"));
                    throw new IllegalStateException("NSD fixture failed");
                }
                return super.getSystemService(name);
            }
        };
        try { CastDiscovery.discover(failing); fail("NSD failure must propagate"); }
        catch (IllegalStateException expected) { assertEquals("NSD fixture failed", expected.getMessage()); }
        assertFalse("Release multicast reception after failure", wifiDump().contains("OpenTubeX Cast discovery"));
    }

    private static String wifiDump() {
        try (var descriptor = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("dumpsys wifi");
             var input = new android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
            var output = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int count; (count = input.read(buffer)) != -1;) output.write(buffer, 0, count);
            return output.toString(StandardCharsets.UTF_8.name());
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

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
            relay.get().complete(event.getString("requestId"), "<MPD><Period/></MPD>", null);
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

    @Test public void senderPreservesNativeAuthenticationErrors() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File fixture = new File(context.getCacheDir(), "cast-error-fixture.sh");
        try {
            for (String code : java.util.List.of("CAST_UNTRUSTED_CERTIFICATE", "CAST_INVALID_AUTHENTICATION",
                "CAST_AUTHENTICATION_DECLINED", "CAST_AUDIO_ONLY")) {
                String script = "echo '{\"event\":\"error\",\"error\":\"Receiver identity verification failed\",\"code\":\"" + code + "\"}'\n";
                java.nio.file.Files.write(fixture.toPath(), script.getBytes(StandardCharsets.UTF_8));
                try (CastTransport sender = new CastTransport("/system/bin/sh", fixture.getAbsolutePath(), 0, event -> {})) {
                    try { sender.connect(); fail("Authentication must reject"); }
                    catch (Exception expected) {
                        CastTransport.Failure failure = CastTransport.failure(expected);
                        assertNotNull(failure);
                        assertEquals(code, failure.code);
                        assertEquals("Receiver identity verification failed", failure.getMessage());
                    }
                }
            }
        } finally { fixture.delete(); }
    }

    @Test public void unsolicitedStartupStatusCannotOwnOrStopExistingMedia() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File fixture = new File(context.getCacheDir(), "cast-startup-status-fixture.sh");
        String namespace = "urn:x-cast:com.google.cast.media";
        String owned = "{\"mediaSessionId\":7,\"media\":{\"contentId\":\"http://media.test/ours.mp4\"}}";
        for (boolean content : new boolean[]{true, false}) {
            String foreign = "{\"mediaSessionId\":42" + (content ? ",\"media\":{\"contentId\":\"http://media.test/other.mp4\"}" : "") + "}";
            String script = "echo '{\"event\":\"connected\",\"address\":\"127.0.0.1\"}'\n" +
                "echo '{\"event\":\"message\",\"namespace\":\"" + namespace + "\",\"payload\":{\"type\":\"MEDIA_STATUS\",\"status\":[" + foreign + "]}}'\n" +
                "status='" + foreign + "'\nwhile read -r command; do\n" +
                "id=${command#*'\"id\":'}\nid=${id%%,*}\n" +
                "case \"$command\" in *'\"type\":\"LOAD\"'*) status='" + owned + "';; esac\n" +
                "echo '{\"event\":\"message\",\"namespace\":\"fixture\",\"payload\":'\"$command\"'}'\n" +
                "echo '{\"event\":\"message\",\"namespace\":\"" + namespace + "\",\"payload\":{\"type\":\"MEDIA_STATUS\",\"requestId\":'\"$id\"',\"status\":['\"$status\"']}}'\n" +
                "done\n";
            LinkedBlockingQueue<JSObject> commands = new LinkedBlockingQueue<>();
            try {
                java.nio.file.Files.write(fixture.toPath(), script.getBytes(StandardCharsets.UTF_8));
                try (CastTransport sender = new CastTransport("/system/bin/sh", fixture.getAbsolutePath(), 0, event -> {
                    if ("fixture".equals(event.getString("namespace"))) commands.add(event.getJSObject("payload").getJSObject("payload"));
                })) {
                    sender.connect();
                    sender.send(namespace, "transport", new JSObject().put("type", "GET_STATUS"), true);
                    assertEquals("GET_STATUS", commands.poll(2, TimeUnit.SECONDS).getString("type"));
                    sender.stopMedia();
                    sender.send(namespace, "transport", new JSObject().put("type", "LOAD")
                        .put("media", new JSObject().put("contentId", "http://media.test/ours.mp4")), true);
                    assertEquals("Existing receiver media must not be stopped", "LOAD", commands.poll(2, TimeUnit.SECONDS).getString("type"));
                    sender.stopMedia();
                    JSObject stopped = commands.poll(2, TimeUnit.SECONDS);
                    assertNotNull("The loaded session can still be stopped", stopped);
                    assertEquals("STOP", stopped.getString("type"));
                    assertEquals(7, stopped.getInt("mediaSessionId"));
                }
            } finally { fixture.delete(); }
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
                catch (Exception expected) { assertTrue("Report the receiver rejection", expected.getMessage().contains("INVALID_REQUEST")); assertEquals("CAST_INVALID_REQUEST", CastTransport.failure(expected).code); }
                JSObject response = sender.send(namespace, "transport", new JSObject().put("type", "GET_STATUS"), true);
                assertEquals("PLAYING", response.getJSONArray("status").getJSONObject(0).getString("playerState"));
            }
        } finally { fixture.delete(); }
    }

    @Test public void brokenStreamClosesWithoutAppendingAnotherResponse() throws Exception {
        for (int alternatives : new int[]{2, 1}) {
            var requests = new java.util.concurrent.atomic.AtomicInteger();
            var upstream = new okhttp3.OkHttpClient.Builder().addInterceptor(chain -> {
                okhttp3.ResponseBody body;
                if (requests.incrementAndGet() == 1) {
                    body = new okhttp3.ResponseBody() {
                        private final okio.BufferedSource source = okio.Okio.buffer(new okio.Source() {
                            private boolean started;
                            @Override public long read(okio.Buffer sink, long count) throws java.io.IOException {
                                if (started) throw new java.io.IOException("Upstream stream reset");
                                started = true;
                                sink.writeUtf8("part");
                                return 4;
                            }
                            @Override public okio.Timeout timeout() { return okio.Timeout.NONE; }
                            @Override public void close() {}
                        });
                        @Override public okhttp3.MediaType contentType() { return okhttp3.MediaType.get("video/mp4"); }
                        @Override public long contentLength() { return 10; }
                        @Override public okio.BufferedSource source() { return source; }
                    };
                } else body = okhttp3.ResponseBody.create("second", okhttp3.MediaType.get("video/mp4"));
                return new okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1)
                    .code(200).message("OK").header("Content-Length", Long.toString(body.contentLength())).body(body).build();
            }).build();
            try (CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null, event -> {}, upstream)) {
                JSObject segment = resource(0, "https://8.8.8.8/", "video/mp4");
                segment.getJSONArray("candidates").getJSONObject(0).put("template", true);
                if (alternatives == 2) segment.getJSONArray("candidates").put(new JSObject().put("url", "https://1.1.1.1/").put("template", true));
                JSArray resources = new JSArray();
                resources.put(segment);
                server.register(resources);
                try (Socket receiver = new Socket("127.0.0.1", new URL(server.origin()).getPort())) {
                    receiver.setSoTimeout(3000);
                    receiver.getOutputStream().write("GET /test-token/0/segment.mp4 HTTP/1.1\r\nHost: localhost\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                    ByteArrayOutputStream wire = new ByteArrayOutputStream();
                    for (int value; (value = receiver.getInputStream().read()) != -1;) wire.write(value);
                    String response = wire.toString(StandardCharsets.US_ASCII.name());
                    assertTrue(response.startsWith("HTTP/1.1 200 OK\r\n"));
                    assertEquals("No fallback or 502 response after streaming starts", "part", response.substring(response.indexOf("\r\n\r\n") + 4));
                    assertEquals("No further candidate may be requested", 1, requests.get());
                }
            }
        }
    }

    @Test public void stalledDashAlternativeFallsBackWithoutLimitingBodyStreaming() throws Exception {
        try (ServerSocket endpoint = new ServerSocket(0)) {
            endpoint.setSoTimeout(8000);
            CompletableFuture<Void> served = new CompletableFuture<>();
            Thread fixture = new Thread(() -> {
                try (Socket stalled = endpoint.accept(); Socket healthy = endpoint.accept()) {
                    healthy.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: 5\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                    // The attempt deadline ends at headers; media may pause longer.
                    Thread.sleep(6000);
                    healthy.getOutputStream().write("video".getBytes(StandardCharsets.US_ASCII));
                    served.complete(null);
                } catch (Exception error) { served.completeExceptionally(error); }
            });
            fixture.start();
            var upstream = new okhttp3.OkHttpClient.Builder().socketFactory(new FixtureSockets("127.0.0.1")).build();
            try (CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null, event -> {}, upstream)) {
                JSObject segment = resource(0, "http://8.8.8.8:" + endpoint.getLocalPort() + "/", "video/mp4");
                segment.getJSONArray("candidates").getJSONObject(0).put("template", true);
                segment.getJSONArray("candidates").put(new JSObject().put("url", "http://8.8.8.8:" + endpoint.getLocalPort() + "/healthy/").put("template", true));
                JSArray resources = new JSArray();
                resources.put(segment);
                server.register(resources);
                HttpURLConnection receiver = (HttpURLConnection) new URL(server.origin() + "/test-token/0/segment.mp4").openConnection(java.net.Proxy.NO_PROXY);
                receiver.setConnectTimeout(3000);
                receiver.setReadTimeout(9000);
                try {
                    assertEquals("Healthy alternative must return headers before the receiver gives up", 200, receiver.getResponseCode());
                    ByteArrayOutputStream body = new ByteArrayOutputStream();
                    try (InputStream input = receiver.getInputStream()) {
                        for (int value; (value = input.read()) != -1;) body.write(value);
                    }
                    assertEquals("Body reads retain the ordinary timeout", "video", body.toString(StandardCharsets.US_ASCII.name()));
                    served.get(2, TimeUnit.SECONDS);
                } finally { receiver.disconnect(); }
            } finally {
                endpoint.close();
                fixture.join(9000);
                assertFalse("Fixture must finish", fixture.isAlive());
            }
        }
    }

    @Test public void relayForwardsOnlyValidHlsReloadParametersAndPreservesSignedQuery() throws Exception {
        LinkedBlockingQueue<Integer> timeouts = new LinkedBlockingQueue<>();
        LinkedBlockingQueue<String> requests = new LinkedBlockingQueue<>();
        AtomicReference<CastMediaServer> relay = new AtomicReference<>();
        okhttp3.OkHttpClient upstream = new okhttp3.OkHttpClient.Builder().addInterceptor(chain -> {
            requests.add(chain.request().url().encodedPath() + "?" + chain.request().url().encodedQuery());
            timeouts.add(chain.readTimeoutMillis());
            if (chain.readTimeoutMillis() == 0) {
                try { Thread.sleep(6000); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new java.io.IOException(error); }
                if (chain.call().isCanceled()) throw new java.io.IOException("Blocking reload must not have a fallback deadline");
            }
            return new okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1)
                .code(200).message("OK").body(okhttp3.ResponseBody.create("#EXTM3U\n", okhttp3.MediaType.get("application/x-mpegurl"))).build();
        }).build();
        try (CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null,
                 event -> relay.get().complete(event.getString("requestId"), event.getString("body"), 360_000), upstream)) {
            relay.set(server);
            JSArray resources = new JSArray();
            JSObject playlist = resource(0, "https://8.8.8.8/live.m3u8?token=a%2fb&dup=a&dup=b&_HLS_msn=1", "application/x-mpegurl");
            playlist.getJSONArray("candidates").put(new JSObject().put("url", "https://1.1.1.1/live.m3u8?_HLS_msn=1"));
            resources.put(playlist);
            JSObject template = resource(1, "https://8.8.8.8/", "video/mp4");
            template.getJSONArray("candidates").getJSONObject(0).put("template", true);
            resources.put(template);
            server.register(resources);
            assertEquals("#EXTM3U\n", fetch(server.origin() + "/test-token/0/media", 200, 9000));
            assertEquals("/live.m3u8?token=a%2fb&dup=a&dup=b&_HLS_msn=1", requests.poll(3, TimeUnit.SECONDS));
            assertEquals("Unknown timing allows blocking headers", 0, (int) timeouts.poll(3, TimeUnit.SECONDS));
            assertEquals("#EXTM3U\n", fetch(server.origin() + "/test-token/0/media?_HLS_msn=123&_HLS_part=0&_HLS_skip=v2", 200));
            assertEquals("/live.m3u8?token=a%2fb&dup=a&dup=b&_HLS_msn=123&_HLS_part=0&_HLS_skip=v2", requests.poll(3, TimeUnit.SECONDS));
            assertEquals("Use the manifest-derived blocking wait", 360_000, (int) timeouts.poll(3, TimeUnit.SECONDS));
            for (String query : new String[]{"token=changed", "_HLS_msn=1&_HLS_msn=2", "_HLS_msn=-1", "_HLS_skip=invalid"}) {
                assertEquals("", fetch(server.origin() + "/test-token/0/media?" + query, 502));
            }
            fetch(server.origin() + "/test-token/1/segment.mp4?number=17&time=2500", 200);
            assertEquals("/segment.mp4?number=17&time=2500", requests.poll(3, TimeUnit.SECONDS));
            assertEquals("Keep ordinary reads bounded", 30_000, (int) timeouts.poll(3, TimeUnit.SECONDS));
        }
    }

    @Test public void abandonedBlockingReloadCancelsItsUpstreamCall() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CompletableFuture<Boolean> cancelled = new CompletableFuture<>();
        var upstream = new okhttp3.OkHttpClient.Builder().addInterceptor(chain -> {
            started.countDown();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
            while (!chain.call().isCanceled() && System.nanoTime() < deadline) {
                try { Thread.sleep(10); } catch (InterruptedException error) { Thread.currentThread().interrupt(); break; }
            }
            cancelled.complete(chain.call().isCanceled());
            throw new java.io.IOException("Receiver abandoned reload");
        }).build();
        try (CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null, event -> {}, upstream)) {
            JSArray resources = new JSArray();
            resources.put(resource(0, "https://8.8.8.8/live.m3u8", "application/x-mpegurl"));
            server.register(resources);
            try (Socket receiver = new Socket("127.0.0.1", Integer.parseInt(server.origin().split(":")[2]))) {
                receiver.getOutputStream().write("GET /test-token/0/media?_HLS_msn=100 HTTP/1.1\r\nHost: localhost\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                assertTrue(started.await(2, TimeUnit.SECONDS));
            }
            assertTrue("Abandoned reload must release its upstream request", cancelled.get(4, TimeUnit.SECONDS));
        }
    }

    @Test public void relayDecodesCompressedManifestsBeforeRewriting() throws Exception {
        for (String encoding : new String[]{"gzip", "deflate", "gzip, deflate", "gzip|deflate", "br", "br, gzip", "br|gzip"}) {
            byte[] encoded = "#EXTM3U\n".getBytes(StandardCharsets.UTF_8);
            for (String layer : encoding.replace("|", ", ").split(", ")) encoded = compress(encoded, layer);
            final byte[] bytes = encoded;
            var upstream = new okhttp3.OkHttpClient.Builder().addInterceptor(chain -> {
                var response = new okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1).code(200).message("OK")
                    .header("Content-Length", Integer.toString(bytes.length)).body(okhttp3.ResponseBody.create(bytes, okhttp3.MediaType.get("application/x-mpegurl")));
                for (String value : encoding.split("\\|")) response.addHeader("Content-Encoding", value);
                return response.build();
            }).build();
            AtomicReference<CastMediaServer> relay = new AtomicReference<>();
            try (CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null,
                event -> relay.get().complete(event.getString("requestId"), event.getString("body"), null), upstream)) {
                relay.set(server);
                JSArray resources = new JSArray();
                resources.put(resource(0, "https://8.8.8.8/live.m3u8", "application/x-mpegurl"));
                server.register(resources);
                assertEquals(encoding, "#EXTM3U\n", fetch(server.origin() + "/test-token/0/media", 200));
            }
        }
    }

    @Test public void relayPreservesCompressedStreamEncodingAndRangeMetadata() throws Exception {
        byte[] bytes = compress(compress("WEBVTT\n".getBytes(StandardCharsets.UTF_8), "gzip"), "deflate");
        var upstream = new okhttp3.OkHttpClient.Builder().addInterceptor(chain ->
            new okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1).code(206).message("Partial Content")
                .addHeader("Content-Encoding", "gzip").addHeader("Content-Encoding", "deflate").header("Content-Length", Integer.toString(bytes.length))
                .header("Content-Range", "bytes 0-" + (bytes.length - 1) + "/" + bytes.length).header("Accept-Ranges", "bytes")
                .body(okhttp3.ResponseBody.create(bytes, okhttp3.MediaType.get("text/vtt"))).build()).build();
        try (CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null, event -> {}, upstream)) {
            JSArray resources = new JSArray();
            resources.put(resource(0, "https://8.8.8.8/caption.vtt", "text/vtt"));
            server.register(resources);
            HttpURLConnection request = (HttpURLConnection) new URL(server.origin() + "/test-token/0/media").openConnection(java.net.Proxy.NO_PROXY);
            request.setRequestProperty("Accept-Encoding", "identity");
            request.setRequestProperty("Range", "bytes=0-");
            request.setReadTimeout(3000);
            try {
                assertEquals(206, request.getResponseCode());
                assertEquals("gzip, deflate", request.getHeaderField("Content-Encoding"));
                assertEquals(bytes.length, request.getContentLength());
                assertEquals("bytes 0-" + (bytes.length - 1) + "/" + bytes.length, request.getHeaderField("Content-Range"));
                assertEquals("bytes", request.getHeaderField("Accept-Ranges"));
                ByteArrayOutputStream received = new ByteArrayOutputStream();
                try (InputStream input = request.getInputStream()) {
                    for (int value; (value = input.read()) != -1;) received.write(value);
                }
                assertArrayEquals(bytes, received.toByteArray());
            } finally { request.disconnect(); }
        }
    }

    @Test public void relayLimitsDecodedManifestSize() throws Exception {
        byte[] decoded = new byte[2_000_001];
        java.util.Arrays.fill(decoded, (byte) 'A');
        for (String encoding : new String[]{"gzip", "br"}) {
            // Brotli fixture expands to 2,000,001 bytes of 'x'.
            byte[] bytes = encoding.equals("br") ? java.util.Base64.getDecoder().decode("m4CEHvgl8OKxQECHzwM=") : compress(decoded, encoding);
            var upstream = new okhttp3.OkHttpClient.Builder().addInterceptor(chain ->
                new okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1).code(200).message("OK")
                    .header("Content-Encoding", encoding).body(okhttp3.ResponseBody.create(bytes, okhttp3.MediaType.get("application/x-mpegurl"))).build()).build();
            java.util.concurrent.atomic.AtomicInteger rewrites = new java.util.concurrent.atomic.AtomicInteger();
            try (CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null, event -> rewrites.incrementAndGet(), upstream)) {
                JSArray resources = new JSArray();
                resources.put(resource(0, "https://8.8.8.8/live.m3u8", "application/x-mpegurl"));
                server.register(resources);
                fetch(server.origin() + "/test-token/0/media", 502);
                assertEquals(0, rewrites.get());
            }
        }
    }

    private static byte[] compress(byte[] bytes, String encoding) throws Exception {
        // Brotli fixture for "#EXTM3U\n", generated with Node's brotliCompressSync.
        if (encoding.equals("br")) {
            assertArrayEquals("#EXTM3U\n".getBytes(StandardCharsets.UTF_8), bytes);
            return java.util.Base64.getDecoder().decode("iwOAI0VYVE0zVQoD");
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (var encoder = encoding.equals("gzip") ? new java.util.zip.GZIPOutputStream(output) : new java.util.zip.DeflaterOutputStream(output)) {
            encoder.write(bytes);
        }
        return output.toByteArray();
    }

    @Test public void resourceTypesCannotInjectHeadersOrPartiallyRegisterABatch() throws Exception {
        try (CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null, event -> {})) {
            for (Object type : new Object[]{"text/vtt\r\nX-Injected: yes", "text/vtt\n", "text/vtt\t", "text/vtt\u0000", "text/vtt\u007f", 42, org.json.JSONObject.NULL}) {
                JSArray batch = new JSArray();
                batch.put(resource(0, "data:text/vtt,WEBVTT", "text/vtt"));
                batch.put(resource(1, "data:text/vtt,WEBVTT", "text/vtt").put("contentType", type));
                try { server.register(batch); fail("Reject unsafe Content-Type before registering any resources"); }
                catch (IllegalArgumentException expected) { assertEquals("Invalid Cast resource content type", expected.getMessage()); }
                fetch(server.origin() + "/test-token/0/media", 404);
                fetch(server.origin() + "/test-token/1/media", 404);
            }
            JSArray valid = new JSArray();
            valid.put(resource(0, "data:text/vtt,WEBVTT", "text/vtt; charset=utf-8"));
            valid.put(resource(1, "data:text/vtt,WEBVTT", ""));
            server.register(valid);
            assertEquals("WEBVTT", fetch(server.origin() + "/test-token/0/media", 200));
            assertEquals("WEBVTT", fetch(server.origin() + "/test-token/1/media", 200));
        }
    }

    @Test public void relayRetiresResourcesWithoutChangingRemainingUrls() throws Exception {
        try (CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null, event -> {})) {
            JSArray initial = new JSArray();
            initial.put(resource(0, "data:text/vtt,expired", "text/vtt"));
            initial.put(resource(1, "data:text/vtt,retained", "text/vtt"));
            server.register(initial);
            assertEquals("expired", fetch(server.origin() + "/test-token/0/media", 200));
            JSArray additions = new JSArray();
            additions.put(resource(2, "data:text/vtt,new", "text/vtt"));
            JSArray removals = new JSArray();
            removals.put(0); removals.put(999);
            server.register(additions, removals);
            fetch(server.origin() + "/test-token/0/media", 404);
            assertEquals("retained", fetch(server.origin() + "/test-token/1/media", 200));
            assertEquals("new", fetch(server.origin() + "/test-token/2/media", 200));
            additions = new JSArray();
            additions.put(resource(3, "data:text/vtt,partial", "text/vtt"));
            additions.put(resource(-1, "data:text/vtt,invalid", "text/vtt"));
            try { server.register(additions, removals); fail("Invalid batch must fail atomically"); }
            catch (IllegalArgumentException expected) {}
            fetch(server.origin() + "/test-token/3/media", 404);
        }
    }

    @Test public void retiringAResourceDoesNotAbortItsOpenResponse() throws Exception {
        LinkedBlockingQueue<JSObject> manifests = new LinkedBlockingQueue<>();
        try (CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null, manifests::add)) {
            JSArray resources = new JSArray();
            resources.put(resource(0, "data:application/dash+xml,%3CMPD%2F%3E", "application/dash+xml"));
            server.register(resources);
            var response = CompletableFuture.supplyAsync(() -> {
                try { return fetch(server.origin() + "/test-token/0/media", 200); }
                catch (Exception error) { throw new RuntimeException(error); }
            });
            JSObject manifest = manifests.poll(3, TimeUnit.SECONDS);
            assertNotNull(manifest);
            JSArray removals = new JSArray();
            removals.put(0);
            server.register(new JSArray(), removals);
            server.complete(manifest.getString("requestId"), "<MPD/>", null);
            assertEquals("<MPD/>", response.get(3, TimeUnit.SECONDS));
            fetch(server.origin() + "/test-token/0/media", 404);
        }
    }

    @Test public void receiverFixtureRoutingPreservesDestinationChecks() throws Exception {
        String port = InstrumentationRegistry.getArguments().getString("castFixturePort");
        org.junit.Assume.assumeTrue(port != null);
        var upstream = new okhttp3.OkHttpClient.Builder().socketFactory(new FixtureSockets()).build();
        try (CastMediaServer server = new CastMediaServer("127.0.0.1", "127.0.0.1", "test-token", null, event -> {}, upstream)) {
            JSArray resources = new JSArray();
            resources.put(resource(0, "http://8.8.8.8:" + port + "/caption.vtt", "text/vtt"));
            resources.put(resource(1, "http://127.0.0.1:" + port + "/caption.vtt", "text/vtt"));
            server.register(resources);
            assertEquals("WEBVTT\n", fetch(server.origin() + "/test-token/0/media", 200));
            fetch(server.origin() + "/test-token/1/media", 502);
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
        AtomicReference<ChromecastPlugin> pluginRef = new AtomicReference<>();
        ready.delete(); finished.delete();
        try (var scenario = androidx.test.core.app.ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                try {
                    var plugin = activity.getBridge().getPlugin("Chromecast").getInstance();
                    pluginRef.set((ChromecastPlugin) plugin);
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
            var mediaField = ChromecastPlugin.class.getDeclaredField("media");
            var clientField = CastMediaServer.class.getDeclaredField("client");
            var idField = ChromecastPlugin.class.getDeclaredField("castId");
            mediaField.setAccessible(true); clientField.setAccessible(true); idField.setAccessible(true);
            CastMediaServer configured = null;
            var markers = new ArrayList<File>();
            long deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(5);
            try {
                while (!finished.exists() && System.nanoTime() < deadline) {
                    CastMediaServer current = (CastMediaServer) mediaField.get(pluginRef.get());
                    if (current != null && current != configured) {
                        // Test topology only: public fixture IP routes to the host HTTP server.
                        // Production URL/DNS checks and receiver authentication remain enabled.
                        var client = (okhttp3.OkHttpClient) clientField.get(current);
                        clientField.set(current, client.newBuilder().socketFactory(new FixtureSockets()).build());
                        File marker = new File(context.getCacheDir(), "cast-relay-" + idField.get(pluginRef.get()));
                        marker.createNewFile(); markers.add(marker);
                        configured = current;
                    }
                    Thread.sleep(100);
                }
            } finally { for (File marker : markers) marker.delete(); }
            assertTrue("External UI integration test completed", finished.exists());
        } finally { ready.delete(); finished.delete(); }
    }

    private static final class FixtureSockets extends javax.net.SocketFactory {
        private final String destination;
        FixtureSockets() { this("10.0.2.2"); }
        FixtureSockets(String destination) { this.destination = destination; }
        @Override public Socket createSocket() {
            return new Socket() {
                @Override public void connect(java.net.SocketAddress endpoint, int timeout) throws java.io.IOException {
                    var address = (java.net.InetSocketAddress) endpoint;
                    if (address.getAddress() != null && address.getAddress().getHostAddress().equals("8.8.8.8")) {
                        endpoint = new java.net.InetSocketAddress(destination, address.getPort());
                    }
                    super.connect(endpoint, timeout);
                }
            };
        }
        private Socket open(java.net.InetSocketAddress address, java.net.InetAddress local, int port) throws java.io.IOException {
            Socket socket = createSocket();
            try {
                if (local != null) socket.bind(new java.net.InetSocketAddress(local, port));
                socket.connect(address);
                return socket;
            } catch (java.io.IOException error) { socket.close(); throw error; }
        }
        @Override public Socket createSocket(String host, int port) throws java.io.IOException {
            return open(new java.net.InetSocketAddress(host, port), null, 0);
        }
        @Override public Socket createSocket(java.net.InetAddress host, int port) throws java.io.IOException {
            return open(new java.net.InetSocketAddress(host, port), null, 0);
        }
        @Override public Socket createSocket(String host, int port, java.net.InetAddress local, int localPort) throws java.io.IOException {
            return open(new java.net.InetSocketAddress(host, port), local, localPort);
        }
        @Override public Socket createSocket(java.net.InetAddress host, int port, java.net.InetAddress local, int localPort) throws java.io.IOException {
            return open(new java.net.InetSocketAddress(host, port), local, localPort);
        }
    }

    private static JSObject resource(int id, String url, String type) {
        JSArray candidates = new JSArray();
        candidates.put(new JSObject().put("url", url));
        return new JSObject().put("id", id).put("contentType", type).put("candidates", candidates);
    }

    private static String fetch(String url, int expectedStatus) throws Exception {
        return fetch(url, expectedStatus, 5000);
    }

    private static String fetch(String url, int expectedStatus, int readTimeout) throws Exception {
        HttpURLConnection request = (HttpURLConnection) new URL(url).openConnection(java.net.Proxy.NO_PROXY);
        request.setConnectTimeout(3000);
        request.setReadTimeout(readTimeout);
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
