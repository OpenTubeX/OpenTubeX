package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class RumblePagesTest {
    private static JSONObject response(int status, JSONObject headers, String body) throws Exception {
        return new JSONObject().put("status", status).put("headers", headers)
            .put("body", Base64.getEncoder().encodeToString(body.getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    public void keepsTheCookieOfTheRedirectToTheSamePage() throws Exception {
        List<JSONObject> requests = new ArrayList<>();
        String url = "https://rumble.com/search/video?q=news";
        JSONObject page = RumblePages.fetch(url, payload -> {
            requests.add(payload);
            JSONObject headers = payload.getJSONObject("headers");
            return headers.has("Cookie")
                ? response(200, new JSONObject(), "<html>results</html>")
                : response(307, new JSONObject()
                    .put("Location", new JSONArray().put(url))
                    .put("set-cookie", new JSONArray()
                        .put("RNSC=1;max-age=3600;path=/;domain=rumble.com;secure;HttpOnly;SameSite=lax")
                        .put("__cf_bm=token; HttpOnly; SameSite=None; Partitioned; Secure; Path=/; Domain=rumble.com; Expires=Thu, 12 Nov 2026 13:27:28 GMT")), "");
        }, new LinkedHashMap<>());

        assertEquals(200, page.getInt("status"));
        assertEquals("<html>results</html>", page.getString("text"));
        assertEquals(2, requests.size());
        assertEquals("RNSC=1; __cf_bm=token", requests.get(1).getJSONObject("headers").getString("Cookie"));
    }

    @Test
    public void loadsOnlyRumblePages() {
        assertTrue(RumblePages.isRumblePage(URI.create("https://rumble.com/c/Example?page=2")));
        for (String url : new String[] {
            "http://rumble.com/c/Example",
            "https://rumble.com.example.test/c/Example",
            "https://notrumble.com/c/Example",
            "https://user@rumble.com/c/Example",
            "https://rumble.com:8443/c/Example",
            "file:///etc/hosts"
        }) {
            assertFalse(url, RumblePages.isRumblePage(URI.create(url)));
        }
        // Nor does it follow redirects elsewhere
        assertThrows(IllegalArgumentException.class, () -> RumblePages.fetch("https://rumble.com/c/Example",
            payload -> response(302, new JSONObject().put("Location", new JSONArray().put("https://example.test/")), ""),
            new LinkedHashMap<>()));
    }
}
