package org.opentubex.app;

import static org.junit.Assert.*;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.Proxy;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.OkHttpClient;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.mockwebserver.MockResponse;
import org.junit.Test;
import org.json.JSONArray;
import org.json.JSONObject;

public class DlnaMediaServerTest {
    private final OkHttpClient client = new OkHttpClient.Builder().proxy(Proxy.NO_PROXY)
        .callTimeout(3, TimeUnit.SECONDS).build();

    @Test public void stalledMergeAfterFirstBytesIsDestroyedAndRequestsRecovery() throws Exception {
        CountDownLatch destroyed = new CountDownLatch(1);
        InputStream input = new InputStream() {
            private boolean first = true;
            @Override public int read() throws IOException {
                if (first) { first = false; return 1; }
                try { destroyed.await(); return -1; }
                catch (InterruptedException error) { throw new IOException(error); }
            }
            @Override public int read(byte[] bytes, int offset, int length) throws IOException {
                int value = read();
                if (value >= 0) { bytes[offset] = (byte) value; return 1; }
                return -1;
            }
        };
        Process process = new Process() {
            @Override public InputStream getInputStream() { return input; }
            @Override public InputStream getErrorStream() { return InputStream.nullInputStream(); }
            @Override public OutputStream getOutputStream() { return OutputStream.nullOutputStream(); }
            @Override public int waitFor() { return 1; }
            @Override public int exitValue() { return 1; }
            @Override public void destroy() { destroyed.countDown(); }
        };
        var reader = Executors.newSingleThreadExecutor();
        try (DlnaMediaServer relay = new DlnaMediaServer(HttpUrl.get("http://127.0.0.1/video"), "127.0.0.1", InetAddress.getLoopbackAddress())) {
            byte[] buffer = new byte[32];
            assertEquals(1, relay.readMerged(process, input, buffer, 100));
            var stalled = reader.submit(() -> relay.readMerged(process, input, buffer, 100));
            assertEquals(-1, (int) stalled.get(1, TimeUnit.SECONDS));
            assertTrue("Stall requests complete-source recovery", relay.muxFailed);
        } finally { process.destroy(); reader.shutdownNow(); }
    }

    @Test public void forwardsRangesAndHeadWithoutCookiesAndRejectsWrongTokens() throws Exception {
        try (MockWebServer upstream = new MockWebServer()) {
            upstream.start();
            try (DlnaMediaServer relay = new DlnaMediaServer(upstream.url("/video.mp4"), "127.0.0.1", InetAddress.getLoopbackAddress())) {
                upstream.enqueue(new MockResponse().setResponseCode(206).setHeader("Content-Range", "bytes 2-5/10")
                    .setHeader("Accept-Ranges", "bytes").setBody("cdef"));
                try (Response response = client.newCall(new Request.Builder().url(relay.mediaUrl())
                        .header("Range", "bytes=2-5").header("Cookie", "must=not-forward").build()).execute()) {
                    assertEquals(206, response.code());
                    assertEquals("bytes 2-5/10", response.header("Content-Range"));
                    assertEquals("cdef", response.body().string());
                }
                var request = upstream.takeRequest(3, TimeUnit.SECONDS);
                assertEquals("bytes=2-5", request.getHeader("Range"));
                assertNull(request.getHeader("Cookie"));
                upstream.enqueue(new MockResponse().setHeader("Content-Length", "10"));
                try (Response head = client.newCall(new Request.Builder().url(relay.mediaUrl()).head().build()).execute()) {
                    assertEquals(200, head.code());
                    assertEquals("10", head.header("Content-Length"));
                    assertEquals("", head.body().string());
                }
                assertEquals("HEAD", upstream.takeRequest(3, TimeUnit.SECONDS).getMethod());
                try (Response denied = client.newCall(new Request.Builder()
                        .url(relay.mediaUrl().replace(relay.castId, "wrong-token")).build()).execute()) {
                    assertEquals(404, denied.code());
                }
                assertEquals(2, upstream.getRequestCount());
                String url = relay.mediaUrl();
                relay.close();
                assertThrows(IOException.class, () -> client.newCall(new Request.Builder().url(url).build()).execute());
            }
        }
    }

    @Test public void usesNativeStreamHeadersWithoutLeakingThemAcrossOrigins() throws Exception {
        try (MockWebServer source = new MockWebServer(); MockWebServer destination = new MockWebServer()) {
            source.start();
            destination.start();
            var media = source.url("/video.mp4").newBuilder().host("127.0.0.1").build();
            ExternalStreamRequestRegistry.shared().register(new JSONArray().put(new JSONObject()
                .put("url", media.toString()).put("http_headers", new JSONObject()
                    .put("User-Agent", "OpenTubeX DLNA test").put("Referer", "https://media.example/"))),
                "127.0.0.1\tFALSE\t/\tFALSE\t0\tprivate\tsecret\n");
            source.enqueue(new MockResponse().setResponseCode(302).setHeader("Location", destination.url("/redirected.mp4")));
            destination.enqueue(new MockResponse().setBody("video"));
            try (DlnaMediaServer relay = new DlnaMediaServer(media, "127.0.0.1", InetAddress.getLoopbackAddress());
                 Response result = client.newCall(new Request.Builder().url(relay.mediaUrl()).build()).execute()) {
                assertEquals("video", result.body().string());
            }
            var initial = source.takeRequest(3, TimeUnit.SECONDS);
            assertEquals("OpenTubeX DLNA test", initial.getHeader("User-Agent"));
            assertEquals("https://media.example/", initial.getHeader("Referer"));
            assertEquals("private=secret", initial.getHeader("Cookie"));
            var redirected = destination.takeRequest(3, TimeUnit.SECONDS);
            assertEquals("OpenTubeX DLNA test", redirected.getHeader("User-Agent"));
            assertNull(redirected.getHeader("Referer"));
            assertNull(redirected.getHeader("Cookie"));
        }
    }

    @Test public void rejectsOtherDevicesBeforeFetchingMedia() throws Exception {
        try (MockWebServer upstream = new MockWebServer()) {
            upstream.start();
            try (DlnaMediaServer relay = new DlnaMediaServer(upstream.url("/video.mp4"), "127.0.0.2", InetAddress.getLoopbackAddress())) {
                assertThrows(IOException.class, () -> client.newCall(new Request.Builder().url(relay.mediaUrl()).build()).execute());
                assertEquals(0, upstream.getRequestCount());
            }
        }
    }
}
