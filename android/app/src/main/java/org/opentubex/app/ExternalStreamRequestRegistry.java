package org.opentubex.app;

import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Keeps yt-dlp's stream credentials in native memory instead of exposing them to the WebView. */
final class ExternalStreamRequestRegistry {
    private static final ExternalStreamRequestRegistry SHARED = new ExternalStreamRequestRegistry();
    private static final Set<String> ALLOWED_HEADERS = Set.of(
        "accept", "accept-language", "origin", "referer", "sec-fetch-mode", "user-agent"
    );
    private final LinkedHashMap<String, Map<String, String>> exact = new LinkedHashMap<>();
    private final LinkedHashMap<String, Map<String, String>> storyboardExact = new LinkedHashMap<>();
    private final LinkedHashMap<String, Map<String, String>> manifestPaths = new LinkedHashMap<>();
    private final List<Cookie> cookies = new ArrayList<>();

    static ExternalStreamRequestRegistry shared() { return SHARED; }

    synchronized void register(JSONArray formats, String cookieFile) {
        Set<String> hosts = new HashSet<>();
        for (int i = 0; i < formats.length(); i++) {
            JSONObject format = formats.optJSONObject(i);
            if (format == null) continue;
            JSONObject rawHeaders = format.optJSONObject("http_headers");
            Map<String, String> headers = new HashMap<>();
            if (rawHeaders != null) {
                for (java.util.Iterator<String> names = rawHeaders.keys(); names.hasNext();) {
                    String name = names.next();
                    String value = rawHeaders.optString(name, "");
                    if (ALLOWED_HEADERS.contains(name.toLowerCase(Locale.ROOT)) &&
                        isSafeHeaderValue(value)) {
                        headers.put(name, value);
                    }
                }
            }
            List<String> candidates = new ArrayList<>(List.of(format.optString("url", ""),
                format.optString("manifest_url", "")));
            if ("mhtml".equals(format.optString("protocol"))) {
                JSONArray fragments = format.optJSONArray("fragments");
                if (fragments != null) {
                    for (int index = 0; index < fragments.length(); index++) {
                        JSONObject fragment = fragments.optJSONObject(index);
                        if (fragment != null) candidates.add(fragment.optString("url", ""));
                    }
                }
            }
            for (String candidate : candidates) {
                URL url = parseUrl(candidate);
                if (url == null) continue;
                hosts.add(url.getHost().toLowerCase(Locale.ROOT));
                String protocol = format.optString("protocol", "");
                if ("mhtml".equals(protocol)) {
                    putBounded(storyboardExact, candidate, Map.copyOf(headers), 50_000);
                } else {
                    putBounded(exact, candidate, Map.copyOf(headers));
                }
                if (Set.of("m3u8", "m3u8_native", "dash", "http_dash_segments").contains(protocol)) {
                    String path = url.getPath();
                    String scope = origin(url) + path.substring(0, path.lastIndexOf('/') + 1);
                    putBounded(manifestPaths, scope, Map.copyOf(headers));
                }
            }
        }
        List<Cookie> extractedCookies = new ArrayList<>();
        long maximumExpiry = System.currentTimeMillis() / 1000 + 3600;
        for (String line : cookieFile.split("\r?\n")) {
            String normalized = line.startsWith("#HttpOnly_") ? line.substring(10) : line;
            if (normalized.startsWith("#")) continue;
            String[] fields = normalized.split("\t", -1);
            if (fields.length != 7 || !fields[5].matches("[!#$%&'*+.^_`|~0-9A-Za-z-]+") ||
                fields[6].contains(";") || !isSafeHeaderValue(fields[6])) continue;
            String domain = fields[0].replaceFirst("^\\.", "").toLowerCase(Locale.ROOT);
            boolean includeSubdomains = "TRUE".equals(fields[1]);
            if (!includeSubdomains && !"FALSE".equals(fields[1])) continue;
            if (hosts.stream().noneMatch(host -> domainMatches(host, domain, includeSubdomains))) continue;
            long expiry;
            try { expiry = Long.parseLong(fields[4]); } catch (NumberFormatException error) { continue; }
            extractedCookies.add(new Cookie(domain, includeSubdomains, fields[2], "TRUE".equals(fields[3]),
                expiry == 0 ? maximumExpiry : Math.min(expiry, maximumExpiry),
                fields[5] + "=" + fields[6]));
        }
        cookies.removeIf(cookie -> hosts.stream().anyMatch(host ->
            domainMatches(host, cookie.domain, cookie.includeSubdomains)));
        cookies.addAll(extractedCookies);
        if (cookies.size() > 1024) cookies.subList(0, cookies.size() - 1024).clear();
    }

    synchronized Map<String, String> headersFor(URL url) {
        Map<String, String> source = sourceHeadersFor(url);
        return source == null ? null : withCookies(source, url);
    }

    synchronized Map<String, String> headersForRedirect(URL original, URL destination) {
        if (parseUrl(destination.toString()) == null) return null;
        Map<String, String> registered = sourceHeadersFor(destination);
        if (registered != null) return withCookies(registered, destination);
        Map<String, String> originalHeaders = sourceHeadersFor(original);
        if (originalHeaders == null) return null;
        if (origin(original).equals(origin(destination))) return withCookies(originalHeaders, destination);
        Map<String, String> safe = new HashMap<>();
        for (Map.Entry<String, String> header : originalHeaders.entrySet()) {
            if (Set.of("accept", "accept-language", "sec-fetch-mode", "user-agent")
                .contains(header.getKey().toLowerCase(Locale.ROOT))) safe.put(header.getKey(), header.getValue());
        }
        return safe;
    }

    private Map<String, String> sourceHeadersFor(URL url) {
        Map<String, String> source = exact.get(url.toString());
        if (source == null) source = storyboardExact.get(url.toString());
        if (source == null) {
            String requestPath = origin(url) + url.getPath();
            for (Map.Entry<String, Map<String, String>> entry : manifestPaths.entrySet()) {
                if (requestPath.startsWith(entry.getKey())) source = entry.getValue();
            }
        }
        return source;
    }

    private Map<String, String> withCookies(Map<String, String> source, URL url) {
        Map<String, String> result = new HashMap<>(source);
        StringBuilder cookieHeader = new StringBuilder();
        long now = System.currentTimeMillis() / 1000;
        for (Cookie cookie : cookies) {
            if (cookie.expires <= now) continue;
            if (!domainMatches(url.getHost().toLowerCase(Locale.ROOT), cookie.domain, cookie.includeSubdomains)) continue;
            if (cookie.secure && !"https".equals(url.getProtocol())) continue;
            if (!url.getPath().equals(cookie.path) &&
                !url.getPath().startsWith(cookie.path.endsWith("/") ? cookie.path : cookie.path + "/")) continue;
            if (cookieHeader.length() > 0) cookieHeader.append("; ");
            cookieHeader.append(cookie.value);
        }
        if (cookieHeader.length() > 0) result.put("Cookie", cookieHeader.toString());
        return result;
    }

    private static boolean domainMatches(String host, String domain, boolean includeSubdomains) {
        return host.equals(domain) || (includeSubdomains && host.endsWith("." + domain));
    }

    private static boolean isSafeHeaderValue(String value) {
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            if (character != '\t' && (character < 0x20 || character > 0x7e)) return false;
        }
        return true;
    }

    private static URL parseUrl(String candidate) {
        try {
            URL url = new URL(candidate);
            return "http".equals(url.getProtocol()) || "https".equals(url.getProtocol()) ? url : null;
        } catch (Exception error) { return null; }
    }

    private static String origin(URL url) {
        return url.getProtocol() + "://" + url.getAuthority();
    }

    private static void putBounded(LinkedHashMap<String, Map<String, String>> map,
                                   String key, Map<String, String> value) {
        putBounded(map, key, value, 256);
    }

    private static void putBounded(LinkedHashMap<String, Map<String, String>> map,
                                   String key, Map<String, String> value, int limit) {
        map.remove(key);
        map.put(key, value);
        if (map.size() > limit) map.remove(map.keySet().iterator().next());
    }

    private static final class Cookie {
        final String domain;
        final boolean includeSubdomains;
        final String path;
        final boolean secure;
        final long expires;
        final String value;
        Cookie(String domain, boolean includeSubdomains, String path, boolean secure, long expires, String value) {
            this.domain = domain;
            this.includeSubdomains = includeSubdomains;
            this.path = path;
            this.secure = secure;
            this.expires = expires;
            this.value = value;
        }
    }
}
