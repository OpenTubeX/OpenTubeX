package org.opentubex.app;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Loads Rumble pages for the renderer. Rumble's Cloudflare front rejects the
 * native HTTP client, so pages load with the Chrome transport of the Rumble
 * HTTP helper. It answers requests without its cookie with a redirect to the
 * same page, so the cookies stay here, apart from the app's other requests.
 */
final class RumblePages {
    interface Transport { JSONObject send(JSONObject payload) throws Exception; }

    private static final int MAX_REDIRECTS = 10;
    private static final int MAX_PAGE_BYTES = 10_000_000;
    // For the page with all its redirects
    private static final long TIMEOUT_MS = 30_000;
    private static final Pattern MAX_AGE = Pattern.compile(";\\s*max-age\\s*=\\s*(-?\\d+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern EXPIRES = Pattern.compile(";\\s*expires\\s*=\\s*([^;]+)", Pattern.CASE_INSENSITIVE);
    // Only Rumble's pages use them, so names and values are enough
    private static final Map<String, String> COOKIES = new LinkedHashMap<>();

    private RumblePages() {}

    static boolean isRumblePage(URI uri) {
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        return "https".equalsIgnoreCase(uri.getScheme()) && uri.getRawUserInfo() == null && uri.getPort() == -1 &&
            (host.equals("rumble.com") || host.endsWith(".rumble.com"));
    }

    /** @param requestedAt from {@link System#nanoTime()}, so the time a request waits to start counts too */
    static JSONObject fetch(String url, Transport transport, long requestedAt) throws Exception {
        return fetch(url, transport, COOKIES, requestedAt);
    }

    static JSONObject fetch(String url, Transport transport, Map<String, String> cookies) throws Exception {
        return fetch(url, transport, cookies, System.nanoTime());
    }

    private static JSONObject fetch(String url, Transport transport, Map<String, String> cookies, long requestedAt) throws Exception {
        URI uri = url == null ? null : URI.create(url);
        long deadline = requestedAt + TimeUnit.MILLISECONDS.toNanos(TIMEOUT_MS);
        for (int redirect = 0; ; redirect++) {
            if (uri == null || !isRumblePage(uri)) throw new IllegalArgumentException("Not a Rumble page");
            long remaining = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime());
            if (remaining <= 0) throw new IOException("Timed out loading the Rumble page");
            JSONObject headers = new JSONObject().put("Accept", "text/html");
            String cookie = cookieHeader(cookies);
            if (!cookie.isEmpty()) headers.put("Cookie", cookie);
            JSONObject result = transport.send(new JSONObject().put("url", uri.toString()).put("method", "GET")
                .put("headers", headers).put("timeout", remaining));

            String location = null;
            JSONObject rawHeaders = result.getJSONObject("headers");
            for (var names = rawHeaders.keys(); names.hasNext();) {
                String name = names.next();
                JSONArray values = rawHeaders.getJSONArray(name);
                for (int index = 0; index < values.length(); index++) {
                    if (name.equalsIgnoreCase("Set-Cookie")) saveCookie(cookies, values.getString(index));
                    else if (name.equalsIgnoreCase("Location")) location = values.getString(index);
                }
            }

            int status = result.getInt("status");
            if (status >= 300 && status < 400 && location != null) {
                if (redirect == MAX_REDIRECTS) throw new IOException("Too many redirects");
                uri = uri.resolve(location);
                continue;
            }
            byte[] body = Base64.getDecoder().decode(result.getString("body"));
            if (body.length > MAX_PAGE_BYTES) throw new IOException("Rumble page is too large");
            return new JSONObject().put("status", status).put("text", new String(body, StandardCharsets.UTF_8));
        }
    }

    private static String cookieHeader(Map<String, String> cookies) {
        synchronized (cookies) {
            StringBuilder header = new StringBuilder();
            for (var cookie : cookies.entrySet()) {
                if (header.length() > 0) header.append("; ");
                header.append(cookie.getKey()).append('=').append(cookie.getValue());
            }
            return header.toString();
        }
    }

    /** Keeps the name and value of a Set-Cookie header, or forgets an expired cookie. */
    private static void saveCookie(Map<String, String> cookies, String header) {
        String pair = header.split(";", 2)[0];
        int equals = pair.indexOf('=');
        if (equals <= 0) return;
        String name = pair.substring(0, equals).trim();
        String value = pair.substring(equals + 1).trim();
        boolean expired = value.isEmpty() || hasExpired(header);
        synchronized (cookies) {
            if (expired) cookies.remove(name);
            else cookies.put(name, value);
        }
    }

    /** Max-Age takes precedence over Expires, whose unreadable dates count as not expired. */
    private static boolean hasExpired(String header) {
        Matcher maxAge = MAX_AGE.matcher(header);
        if (maxAge.find()) return maxAge.group(1).startsWith("-") || maxAge.group(1).matches("0+");
        Matcher expires = EXPIRES.matcher(header);
        if (!expires.find()) return false;
        try {
            // Also with the dashes of the older cookie date format
            String date = expires.group(1).trim().replace('-', ' ');
            return !ZonedDateTime.parse(date, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().isAfter(Instant.now());
        } catch (DateTimeParseException error) {
            return false;
        }
    }
}
