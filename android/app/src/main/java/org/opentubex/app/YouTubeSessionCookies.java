package org.opentubex.app;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;

/** Converts only YouTube's browser cookies into yt-dlp's Netscape cookie format. */
final class YouTubeSessionCookies {
    static boolean isYouTube(String url) {
        return allowedHost(url, false);
    }

    static boolean canNavigate(String url) {
        return allowedHost(url, true);
    }

    private static boolean allowedHost(String url, boolean login) {
        try {
            URI uri = new URI(url);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null ||
                uri.getRawUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return false;
            host = host.toLowerCase(java.util.Locale.ROOT);
            return host.equals("youtube.com") || host.endsWith(".youtube.com") ||
                (login && (host.equals("accounts.google.com") || host.equals("consent.google.com")));
        } catch (Exception error) { return false; }
    }

    static String serialize(String header) {
        if (header == null || header.isBlank() || header.length() > 1024 * 1024 ||
            header.indexOf('\n') >= 0 || header.indexOf('\r') >= 0 || header.indexOf('\t') >= 0) {
            throw new IllegalArgumentException("Invalid YouTube cookies");
        }
        Map<String, String> cookies = new LinkedHashMap<>();
        for (String cookie : header.split(";")) {
            int separator = cookie.indexOf('=');
            if (separator < 1) continue;
            String name = cookie.substring(0, separator).trim();
            String value = cookie.substring(separator + 1).trim();
            if (!name.matches("[!#$%&'*+.^_`|~0-9A-Za-z-]+")) continue;
            cookies.put(name, value);
        }
        if (cookies.isEmpty()) throw new IllegalArgumentException("No YouTube cookies");
        StringBuilder result = new StringBuilder("# Netscape HTTP Cookie File\n");
        cookies.forEach((name, value) -> result.append(".youtube.com\tTRUE\t/\tTRUE\t0\t")
            .append(name).append('\t').append(value).append('\n'));
        return result.toString();
    }
}
