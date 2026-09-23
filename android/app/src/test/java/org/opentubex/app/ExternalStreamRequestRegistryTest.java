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
        registry.register(new JSONArray()
            .put(new JSONObject().put("url", "https://media.example/foo/video.mp4").put("protocol", "https"))
            .put(new JSONObject().put("url", "http://media.example/foo/video.mp4").put("protocol", "http")),
            "media.example\tFALSE\t/foo\tTRUE\t0\tsession\ttoken\n");
        assertEquals("session=token", registry.headersFor(new URL("https://media.example/foo/video.mp4")).get("Cookie"));
        assertNotNull(registry.headersFor(new URL("http://media.example/foo/video.mp4")));
        assertNull(registry.headersFor(new URL("http://media.example/foo/video.mp4")).get("Cookie"));
        assertNull(registry.headersFor(new URL("https://media.example/foobar/video.mp4")));
    }

    @Test public void hostOnlyCookiesDoNotReachSubdomains() throws Exception {
        ExternalStreamRequestRegistry registry = new ExternalStreamRequestRegistry();
        JSONArray formats = new JSONArray().put(new JSONObject()
            .put("url", "https://cdn.media.example/video.mp4").put("protocol", "https"));
        registry.register(formats, "media.example\tFALSE\t/\tFALSE\t0\tsession\thost-only\n");
        assertNull(registry.headersFor(new URL("https://cdn.media.example/video.mp4")).get("Cookie"));

        registry.register(formats, ".media.example\tTRUE\t/\tFALSE\t0\tsession\tall-hosts\n");
        assertEquals("session=all-hosts", registry.headersFor(new URL("https://cdn.media.example/video.mp4")).get("Cookie"));
    }

    @Test public void emptyExtractionClearsPreviouslyRegisteredCookies() throws Exception {
        ExternalStreamRequestRegistry registry = new ExternalStreamRequestRegistry();
        JSONArray formats = new JSONArray().put(new JSONObject()
            .put("url", "https://media.example/video.mp4").put("protocol", "https"));
        registry.register(formats, "media.example\tFALSE\t/\tFALSE\t0\tsession\told\n");
        assertEquals("session=old", registry.headersFor(new URL("https://media.example/video.mp4")).get("Cookie"));

        registry.register(formats, "# Netscape HTTP Cookie File\n");
        assertNull(registry.headersFor(new URL("https://media.example/video.mp4")).get("Cookie"));
    }

    @Test public void redirectsKeepCredentialsOnlyOnTheirRegisteredOriginAndCookiePath() throws Exception {
        ExternalStreamRequestRegistry registry = new ExternalStreamRequestRegistry();
        URL source = new URL("https://media.example/foo/video.mp4");
        registry.register(new JSONArray().put(new JSONObject()
            .put("url", source.toString()).put("protocol", "https")
            .put("http_headers", new JSONObject().put("Referer", "https://media.example/private?token=secret")
                .put("User-Agent", "test-agent"))),
            "media.example\tFALSE\t/foo\tTRUE\t0\tsession\ttoken\n");

        Map<String, String> samePath = registry.headersForRedirect(source, new URL("https://media.example/foo/redirected.mp4"));
        assertEquals("session=token", samePath.get("Cookie"));
        assertEquals("https://media.example/private?token=secret", samePath.get("Referer"));

        Map<String, String> otherPath = registry.headersForRedirect(source, new URL("https://media.example/bar/video.mp4"));
        assertNull(otherPath.get("Cookie"));
        assertEquals("test-agent", otherPath.get("User-Agent"));

        Map<String, String> otherHost = registry.headersForRedirect(source, new URL("https://cdn.example/video.mp4"));
        assertEquals("test-agent", otherHost.get("User-Agent"));
        assertNull(otherHost.get("Referer"));
        assertNull(otherHost.get("Cookie"));

        Map<String, String> downgrade = registry.headersForRedirect(source, new URL("http://media.example/foo/video.mp4"));
        assertEquals("test-agent", downgrade.get("User-Agent"));
        assertNull(downgrade.get("Referer"));
        assertNull(downgrade.get("Cookie"));
    }
}
