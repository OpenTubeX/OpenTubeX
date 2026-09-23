package org.opentubex.app;

import java.net.URL;
import java.util.concurrent.TimeUnit;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class ExternalStreamRedirectsTest {
    @Test public void keepsScopedHeadersOnSameOriginRedirects() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.start();
            server.enqueue(new MockResponse().setResponseCode(302).addHeader("Location", "/foo/target.mp4"));
            server.enqueue(new MockResponse().setResponseCode(200));
            URL sourceUrl = server.url("/foo/video.mp4").url();
            ExternalStreamRequestRegistry.shared().register(new JSONArray().put(new JSONObject()
                .put("url", sourceUrl.toString()).put("protocol", "http")
                .put("http_headers", new JSONObject().put("Referer", "http://media.example/"))),
                sourceUrl.getHost() + "\tFALSE\t/foo\tFALSE\t0\tsession\ttoken\n");
            Request.Builder request = new Request.Builder().url(sourceUrl);
            ExternalStreamRequestRegistry.shared().headersFor(sourceUrl).forEach(request::header);
            try (Response response = ExternalStreamRedirects.client().newCall(request.build()).execute()) {
                assertEquals(200, response.code());
            }
            assertNotNull(server.takeRequest(5, TimeUnit.SECONDS));
            RecordedRequest redirected = server.takeRequest(5, TimeUnit.SECONDS);
            assertNotNull(redirected);
            assertEquals("session=token", redirected.getHeader("Cookie"));
            assertEquals("http://media.example/", redirected.getHeader("Referer"));
        }
    }

    @Test public void stripsCredentialsWhenRedirectLeavesTheSourceOrigin() throws Exception {
        try (MockWebServer source = new MockWebServer(); MockWebServer target = new MockWebServer()) {
            source.start();
            target.start();
            source.enqueue(new MockResponse().setResponseCode(302)
                .addHeader("Location", target.url("/video.mp4")));
            target.enqueue(new MockResponse().setResponseCode(200));
            URL sourceUrl = source.url("/video.mp4").url();
            ExternalStreamRequestRegistry.shared().register(new JSONArray().put(new JSONObject()
                .put("url", sourceUrl.toString()).put("protocol", "http")
                .put("http_headers", new JSONObject().put("Referer", "http://127.0.0.1/private?token=secret")
                    .put("User-Agent", "test-agent"))),
                sourceUrl.getHost() + "\tFALSE\t/\tFALSE\t0\tsession\ttoken\n");
            Request.Builder request = new Request.Builder().url(sourceUrl).header("Range", "bytes=100-");
            ExternalStreamRequestRegistry.shared().headersFor(sourceUrl).forEach(request::header);
            try (Response response = ExternalStreamRedirects.client().newCall(request.build()).execute()) {
                assertEquals(200, response.code());
            }
            RecordedRequest original = source.takeRequest(5, TimeUnit.SECONDS);
            assertNotNull(original);
            assertEquals("session=token", original.getHeader("Cookie"));
            assertEquals("http://127.0.0.1/private?token=secret", original.getHeader("Referer"));
            RecordedRequest redirected = target.takeRequest(5, TimeUnit.SECONDS);
            assertNotNull(redirected);
            assertNull(redirected.getHeader("Cookie"));
            assertNull(redirected.getHeader("Referer"));
            assertEquals("test-agent", redirected.getHeader("User-Agent"));
            assertEquals("bytes=100-", redirected.getHeader("Range"));
        }
    }
}
