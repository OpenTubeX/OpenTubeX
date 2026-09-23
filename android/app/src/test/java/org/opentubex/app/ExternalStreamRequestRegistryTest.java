package org.opentubex.app;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.net.URL;
import java.util.Map;
import static org.junit.Assert.*;

public class ExternalStreamRequestRegistryTest {
    @Test public void forwardsHeadersAndCookiesOnlyToRegisteredMediaPaths() throws Exception {
        ExternalStreamRequestRegistry registry = new ExternalStreamRequestRegistry();
        JSONObject format = new JSONObject()
            .put("url", "https://media.example/foo/master.m3u8?token=1")
            .put("protocol", "m3u8_native")
            .put("http_headers", new JSONObject().put("Referer", "https://example.com/")
                .put("User-Agent", "test-agent").put("Authorization", "secret"));
        String cookies = "media.example\tFALSE\t/foo\tTRUE\t0\tsession\ttoken\n";
        registry.register(new JSONArray().put(format), cookies);

        Map<String, String> segment = registry.headersFor(new URL("https://media.example/foo/segment.ts"));
        assertEquals("https://example.com/", segment.get("Referer"));
        assertEquals("test-agent", segment.get("User-Agent"));
        assertEquals("session=token", segment.get("Cookie"));
        assertFalse(segment.containsKey("Authorization"));
        assertNull(registry.headersFor(new URL("https://media.example/foobar/segment.ts")));
        assertNull(registry.headersFor(new URL("https://other.example/foo/segment.ts")));
    }

    @Test public void matchesCookiePathAtSegmentBoundaryForDirectMedia() throws Exception {
        ExternalStreamRequestRegistry registry = new ExternalStreamRequestRegistry();
        registry.register(new JSONArray().put(new JSONObject()
            .put("url", "https://media.example/foo/video.mp4")
            .put("protocol", "https")),
            "media.example\tFALSE\t/foo\tTRUE\t0\tsession\ttoken\n");
        assertEquals("session=token", registry.headersFor(new URL("https://media.example/foo/video.mp4")).get("Cookie"));
        assertNull(registry.headersFor(new URL("http://media.example/foo/video.mp4")));
        assertNull(registry.headersFor(new URL("https://media.example/foobar/video.mp4")));
    }
}
