package org.opentubex.app;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.LongSupplier;

final class SabrRequestRegistry {
    private static final long DEFAULT_TTL_MS = 30_000;
    private static final String PROXY_PATH_PREFIX = "/_opentubex_sabr/";
    private static final SabrRequestRegistry SHARED = new SabrRequestRegistry(
        System::currentTimeMillis,
        DEFAULT_TTL_MS
    );

    static final class PreparedRequest {
        private final String id;
        private final URL url;
        private final byte[] body;
        private final Map<String, String> headers;
        private final long expiresAtMs;
        private boolean consumed;
        private boolean cancelled;
        private HttpURLConnection connection;

        private PreparedRequest(
            String id,
            URL url,
            byte[] body,
            Map<String, String> headers,
            long expiresAtMs
        ) {
            this.id = id;
            this.url = url;
            this.body = body.clone();
            this.headers = Map.copyOf(headers);
            this.expiresAtMs = expiresAtMs;
        }

        String id() {
            return id;
        }

        URL url() {
            return url;
        }

        byte[] body() {
            return body;
        }

        Map<String, String> headers() {
            return headers;
        }
    }

    private final LongSupplier clock;
    private final long ttlMs;
    private final Map<String, PreparedRequest> requests = new HashMap<>();

    private SabrRequestRegistry(LongSupplier clock, long ttlMs) {
        this.clock = clock;
        this.ttlMs = ttlMs;
    }

    static SabrRequestRegistry shared() {
        return SHARED;
    }

    static SabrRequestRegistry forTests(LongSupplier clock, long ttlMs) {
        return new SabrRequestRegistry(clock, ttlMs);
    }

    static boolean isAllowedUrl(URL url) {
        String host = url.getHost();
        return "https".equals(url.getProtocol()) &&
            ("googlevideo.com".equals(host) || host.endsWith(".googlevideo.com")) &&
            "/videoplayback".equals(url.getPath());
    }

    static String requestIdFromProxyUrl(URL url) {
        if (!"https".equals(url.getProtocol()) ||
            !"localhost".equals(url.getHost()) ||
            url.getPort() != -1 ||
            url.getUserInfo() != null ||
            url.getQuery() != null ||
            url.getRef() != null ||
            !url.getPath().startsWith(PROXY_PATH_PREFIX)) {
            return null;
        }

        String requestId = url.getPath().substring(PROXY_PATH_PREFIX.length());
        if (requestId.contains("/")) {
            return null;
        }

        try {
            return UUID.fromString(requestId).toString().equals(requestId)
                ? requestId
                : null;
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    synchronized String prepare(URL url, byte[] body, Map<String, String> headers) {
        purgeExpired();
        String id = UUID.randomUUID().toString();
        requests.put(id, new PreparedRequest(
            id,
            url,
            body,
            headers,
            clock.getAsLong() + ttlMs
        ));
        return id;
    }

    synchronized PreparedRequest consume(String id) {
        purgeExpired();
        PreparedRequest request = requests.get(id);
        if (request == null || request.consumed || request.cancelled) {
            return null;
        }

        request.consumed = true;
        return request;
    }

    synchronized boolean activate(PreparedRequest request, HttpURLConnection connection) {
        if (requests.get(request.id) != request || request.cancelled) {
            connection.disconnect();
            return false;
        }

        request.connection = connection;
        return true;
    }

    synchronized void complete(PreparedRequest request) {
        requests.remove(request.id, request);
        request.connection = null;
    }

    synchronized boolean discard(String id) {
        PreparedRequest request = requests.remove(id);
        if (request == null) {
            return false;
        }

        cancel(request);
        return true;
    }

    synchronized void clear() {
        for (PreparedRequest request : requests.values()) {
            cancel(request);
        }
        requests.clear();
    }

    synchronized int size() {
        purgeExpired();
        return requests.size();
    }

    private void purgeExpired() {
        long now = clock.getAsLong();
        requests.values().removeIf(request -> {
            if (request.consumed || request.expiresAtMs > now) {
                return false;
            }
            cancel(request);
            return true;
        });
    }

    private static void cancel(PreparedRequest request) {
        request.cancelled = true;
        if (request.connection != null) {
            request.connection.disconnect();
            request.connection = null;
        }
    }
}
