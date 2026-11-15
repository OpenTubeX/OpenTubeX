package org.opentubex.app;

import static org.junit.Assert.*;

import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.Test;

public class YtDlpReleaseTest {
    private static String origin(MockWebServer server) {
        String url = server.url("/").toString();
        return url.substring(0, url.length() - 1);
    }

    @Test public void readsTheLatestTagFromTheReleaseRedirect() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.start();
            server.enqueue(new MockResponse().setResponseCode(302)
                .addHeader("Location", origin(server) + "/yt-dlp/yt-dlp/releases/tag/2026.10.21"));
            assertEquals("2026.10.21", YtDlpRelease.latestTag(origin(server), "yt-dlp/yt-dlp"));
            RecordedRequest request = server.takeRequest(5, TimeUnit.SECONDS);
            assertEquals("HEAD", request.getMethod());
            assertEquals("/yt-dlp/yt-dlp/releases/latest", request.getPath());
            // The release page itself is never requested.
            assertEquals(1, server.getRequestCount());
        }
    }

    @Test public void rejectsResponsesWithoutAReleaseTag() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.start();
            server.enqueue(new MockResponse().setResponseCode(403));
            server.enqueue(new MockResponse().setResponseCode(302).addHeader("Location", origin(server) + "/yt-dlp/yt-dlp/releases"));
            server.enqueue(new MockResponse().setResponseCode(302)
                .addHeader("Location", "https://example.com/yt-dlp/yt-dlp/releases/tag/2026.10.21"));
            for (int i = 0; i < 3; i++) {
                assertThrows(IOException.class, () -> YtDlpRelease.latestTag(origin(server), "yt-dlp/yt-dlp"));
            }
        }
    }

    @Test public void comparesReleaseVersionsNumerically() {
        assertTrue(YtDlpRelease.compare("2025.11.12", "2026.10.21") < 0);
        assertTrue(YtDlpRelease.compare("2026.10.21.232806", "2026.10.21") > 0);
        assertTrue(YtDlpRelease.compare("2026.9.1", "2026.10.1") < 0);
        assertEquals(0, YtDlpRelease.compare("2026.10.21", "2026.10.21"));
    }
}
