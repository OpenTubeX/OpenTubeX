package org.opentubex.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.IOException;
import java.net.URL;
import java.net.HttpURLConnection;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

public class SabrHttpPluginTest {
    @Test
    public void onlyAllowsHttpsGoogleVideoUrls() throws Exception {
        assertTrue(SabrHttpPlugin.isAllowedUrl(
            new URL("https://rr1---sn.example.googlevideo.com/videoplayback")
        ));
        assertFalse(SabrHttpPlugin.isAllowedUrl(
            new URL("http://rr1---sn.example.googlevideo.com/videoplayback")
        ));
        assertFalse(SabrHttpPlugin.isAllowedUrl(
            new URL("https://googlevideo.com.example.com/videoplayback")
        ));
        assertFalse(SabrHttpPlugin.isAllowedUrl(
            new URL("https://example.googlevideo.com/not-video")
        ));
    }

    @Test
    public void onlyAcceptsExactSameOriginProxyUrls() throws Exception {
        String id = "3d9a5a1e-a635-4c45-a0db-43f6a675dc25";
        assertEquals(id, SabrRequestRegistry.requestIdFromProxyUrl(
            new URL("https://localhost/_opentubex_sabr/" + id)
        ));
        assertNull(SabrRequestRegistry.requestIdFromProxyUrl(
            new URL("http://localhost/_opentubex_sabr/" + id)
        ));
        assertNull(SabrRequestRegistry.requestIdFromProxyUrl(
            new URL("https://localhost.example/_opentubex_sabr/" + id)
        ));
        assertNull(SabrRequestRegistry.requestIdFromProxyUrl(
            new URL("https://localhost/_opentubex_sabr/" + id + "/extra")
        ));
        assertNull(SabrRequestRegistry.requestIdFromProxyUrl(
            new URL("https://localhost/_opentubex_sabr/" + id + "?replay=true")
        ));
    }

    @Test
    public void preparedRequestsCanOnlyBeConsumedOnce() throws Exception {
        SabrRequestRegistry registry = SabrRequestRegistry.forTests(() -> 0, 100);
        String id = registry.prepare(
            new URL("https://example.googlevideo.com/videoplayback"),
            new byte[] { 1, 2, 3 },
            Map.of("Accept", "application/vnd.yt-ump")
        );

        SabrRequestRegistry.PreparedRequest request = registry.consume(id);
        assertEquals(id, request.id());
        assertNull(registry.consume(id));
        assertEquals(1, registry.size());

        registry.complete(request);
        assertEquals(0, registry.size());
    }

    @Test
    public void unconsumedRequestsExpireAndCanBeDiscarded() throws Exception {
        AtomicLong now = new AtomicLong(10);
        SabrRequestRegistry registry = SabrRequestRegistry.forTests(now::get, 100);
        String expiredId = registry.prepare(
            new URL("https://example.googlevideo.com/videoplayback"),
            new byte[] { 1 },
            Map.of()
        );
        now.set(110);
        assertNull(registry.consume(expiredId));

        String discardedId = registry.prepare(
            new URL("https://example.googlevideo.com/videoplayback"),
            new byte[] { 2 },
            Map.of()
        );
        assertTrue(registry.discard(discardedId));
        assertFalse(registry.discard(discardedId));
        assertNull(registry.consume(discardedId));
    }

    @Test
    public void discardingAConsumedRequestDisconnectsIt() throws Exception {
        SabrRequestRegistry registry = SabrRequestRegistry.forTests(() -> 0, 100);
        String id = registry.prepare(
            new URL("https://example.googlevideo.com/videoplayback"),
            new byte[] { 1 },
            Map.of()
        );
        SabrRequestRegistry.PreparedRequest request = registry.consume(id);
        TestConnection connection = new TestConnection();

        assertTrue(registry.activate(request, connection));
        assertTrue(registry.discard(id));
        assertTrue(connection.disconnected);
    }

    private static final class TestConnection extends HttpURLConnection {
        private boolean disconnected;

        private TestConnection() throws IOException {
            super(new URL("https://example.googlevideo.com/videoplayback"));
        }

        @Override
        public void disconnect() {
            disconnected = true;
        }

        @Override
        public boolean usingProxy() {
            return false;
        }

        @Override
        public void connect() {}
    }
}
