package org.opentubex.app;

import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class RumbleManifestTransportTest {
    @Test public void appliesDomainCookiesToUnregisteredManifestRedirects() throws Exception {
        URL source = new URL("https://rumble.com/challenge/master.m3u8");
        ExternalStreamRequestRegistry registry = ExternalStreamRequestRegistry.shared();
        for (String destination : new String[] { "https://challengecdn.rumble.com/challenge/final.m3u8",
            "http://challengecdn.rumble.com/challenge/final.m3u8",
            "https://unrelated.example/challenge/final.m3u8",
            "https://challengecdn.rumble.com/elsewhere/final.m3u8" }) {
            registry.register(new JSONArray().put(new JSONObject().put("url", source.toString())
                .put("protocol", "m3u8_native").put("http_headers", new JSONObject()
                    .put("User-Agent", "fixture-agent").put("Referer", "https://rumble.com/private"))),
                "rumble.com\tFALSE\t/challenge\tTRUE\t0\thostOnly\tfixture\n");
            List<Request> requests = new ArrayList<>();
            var client = ExternalStreamRedirects.client().newBuilder().addInterceptor(chain -> {
                Request request = chain.request();
                requests.add(request);
                try {
                    boolean redirect = requests.size() == 1;
                    JSONObject headers = redirect ? new JSONObject().put("Location", new JSONArray().put(destination))
                        .put("Set-Cookie", new JSONArray().put("domainChallenge=fixture; Domain=.rumble.com; Path=/challenge; Secure"))
                        : new JSONObject();
                    return RumbleManifestTransport.responseFromPayload(request, new JSONObject()
                        .put("status", redirect ? 302 : 200).put("headers", headers).put("body", ""));
                } catch (org.json.JSONException error) { throw new java.io.IOException(error); }
            }).build();
            Request.Builder request = new Request.Builder().url(source);
            registry.headersFor(source).forEach(request::header);
            request.header("Cookie", "caller=private").header("Authorization", "Bearer private");
            try (Response response = ExternalStreamRedirects.fetchForWebView(request.build(), client)) {
                assertEquals(200, response.code());
            }
            assertEquals(2, requests.size());
            Request redirected = requests.get(1);
            assertEquals("fixture-agent", redirected.header("User-Agent"));
            assertNull(redirected.header("Referer"));
            assertNull(redirected.header("Authorization"));
            if (destination.equals("https://challengecdn.rumble.com/challenge/final.m3u8")) {
                assertEquals("domainChallenge=fixture", redirected.header("Cookie"));
            } else {
                assertNull(redirected.header("Cookie"));
            }
        }
    }

    @Test public void followsManifestRedirectWithNewAndReplacedCookies() throws Exception {
        URL source = new URL("https://rumble.com/media/master.m3u8");
        ExternalStreamRequestRegistry registry = ExternalStreamRequestRegistry.shared();
        JSONArray formats = new JSONArray();
        for (String url : new String[] { source.toString(), "https://cdn.rumble.com/media/final.m3u8",
            "http://rumble.com/media/final.m3u8" }) {
            formats.put(new JSONObject().put("url", url).put("protocol", "m3u8_native"));
        }
        registry.register(formats,
            "rumble.com\tFALSE\t/media\tTRUE\t0\tsession\told\n" +
            "rumble.com\tFALSE\t/media\tTRUE\t0\tretained\tfixture\n" +
            "rumble.com\tFALSE\t/media\tTRUE\t0\texpired\told\n");
        List<Request> requests = new ArrayList<>();
        var client = ExternalStreamRedirects.client().newBuilder().addInterceptor(chain -> {
            Request request = chain.request();
            requests.add(request);
            try {
                boolean redirect = requests.size() == 1;
                JSONObject headers = redirect ? new JSONObject().put("Location", new JSONArray().put("/media/final.m3u8"))
                    .put("Set-Cookie", new JSONArray().put("session=new; Path=/media; Secure")
                        .put("challenge=fixture; Path=/media; Secure")
                        .put("expired=removed; Path=/media; Max-Age=0")
                        .put("wrong=fixture; Domain=unrelated.example; Path=/media")
                        .put("otherPath=fixture; Path=/elsewhere")) : new JSONObject();
                return RumbleManifestTransport.responseFromPayload(request, new JSONObject()
                    .put("status", redirect ? 302 : 200).put("headers", headers).put("body", ""));
            } catch (org.json.JSONException error) { throw new java.io.IOException(error); }
        }).build();
        Request.Builder request = new Request.Builder().url(source);
        registry.headersFor(source).forEach(request::header);
        try (Response response = ExternalStreamRedirects.fetchForWebView(request.build(), client)) {
            assertEquals(200, response.code());
        }
        assertEquals(2, requests.size());
        String cookies = requests.get(1).header("Cookie");
        assertNotNull(cookies);
        assertTrue(cookies, cookies.contains("session=new"));
        assertTrue(cookies, cookies.contains("challenge=fixture"));
        assertTrue(cookies, cookies.contains("retained=fixture"));
        assertFalse(cookies, cookies.contains("session=old"));
        assertFalse(cookies, cookies.contains("expired="));
        assertFalse(cookies, cookies.contains("wrong="));
        assertFalse(cookies, cookies.contains("otherPath="));
        assertNull(registry.headersForRedirect(source, new URL("https://cdn.rumble.com/media/final.m3u8")).get("Cookie"));
        assertNull(registry.headersForRedirect(source, new URL("http://rumble.com/media/final.m3u8")).get("Cookie"));
    }
}
