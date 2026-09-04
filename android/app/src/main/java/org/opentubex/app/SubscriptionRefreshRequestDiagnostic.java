package org.opentubex.app;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

final class SubscriptionRefreshRequestDiagnostic {
    final String category;
    final String backend;
    final String lifecycle;
    final String failure;
    final String code;
    final String message;

    private SubscriptionRefreshRequestDiagnostic(
        String category,
        String backend,
        String failure,
        String code,
        String message
    ) {
        this.category = category;
        this.backend = backend;
        this.lifecycle = "background";
        this.failure = failure;
        this.code = code;
        this.message = message;
    }

    static SubscriptionRefreshRequestDiagnostic create(String feedType, Throwable error) {
        return create(feedType, "Invidious API", error);
    }

    static SubscriptionRefreshRequestDiagnostic create(
        String feedType,
        String backend,
        Throwable error
    ) {
        Throwable cause = deepestCause(error);
        return new SubscriptionRefreshRequestDiagnostic(
            category(feedType),
            backend,
            classify(cause),
            cause.getClass().getSimpleName(),
            sanitize(cause.getMessage())
        );
    }

    JSONObject toJson() throws JSONException {
        return new JSONObject()
            .put("category", category)
            .put("backend", backend)
            .put("lifecycle", lifecycle)
            .put("failure", failure)
            .put("code", code)
            .put("message", message);
    }

    @Override
    public String toString() {
        return "request=" + category +
            "; backend=" + backend +
            "; lifecycle=" + lifecycle +
            "; failure=" + failure +
            "; code=" + code +
            "; message=" + message;
    }

    private static Throwable deepestCause(Throwable error) {
        Throwable cause = error;
        while (cause.getCause() != null && cause.getCause() != cause) cause = cause.getCause();
        return cause;
    }

    private static String category(String feedType) {
        switch (feedType) {
            case "shorts":
                return "subscription Shorts";
            case "live":
                return "subscription live streams";
            case "posts":
                return "subscription posts";
            default:
                return "subscription videos";
        }
    }

    private static String classify(Throwable error) {
        String signature = (error.getClass().getName() + " " + error.getMessage())
            .toLowerCase(Locale.ROOT);
        if (signature.matches(".*(cancel|interrupt|aborted).*")) return "cancellation";
        if (signature.matches(
            ".*(foregroundservicestartnotallowed|backgroundservicestartnotallowed|" +
                "(foreground|background) service.*(not allowed|restrict)|" +
                "background execution.*(not allowed|restrict)).*"
        )) return "background restriction";
        if (signature.matches(".*\\bhttp\\s+\\d{3}\\b.*")) return "http";
        if (signature.matches(".*(ssl|tls|certificate|certpath|handshake).*")) return "tls";
        if (signature.matches(".*(json|parse|parsing|unexpected token).*")) return "parsing";
        if (signature.matches(
            ".*(unknownhost|gai|addrinfo|eai_|dns|network|socket|timeout|timed out|connect).*"
        )) {
            return "network";
        }
        return "api";
    }

    private static String sanitize(String rawMessage) {
        String message = rawMessage == null ? "No error message" : rawMessage;
        message = message.replaceAll(
            "(?i)(https?://)(?:[^/@\\s?#]+@)?([^/\\s?#]+)[^\\s)]*",
            "$1$2"
        );
        message = message.replaceAll(
            "(?i)authorization\\s*:\\s*(?:bearer\\s+)?[^\\s,;]+",
            "Authorization: <redacted>"
        );
        message = message.replaceAll(
            "(?i)\\b(bearer|basic)\\s+[A-Za-z0-9._~+/=-]+",
            "$1 <redacted>"
        );
        message = message.replaceAll(
            "(?i)\\b(?:cookie|set-cookie)\\s*:\\s*[^\\r\\n]*",
            "Cookie: <redacted>"
        );
        message = message.replaceAll(
            "(?i)\\b(access[_-]?token|refresh[_-]?token|id[_-]?token|token|" +
                "api[_-]?key|client[_-]?secret|password|secret)[\"']?\\s*[:=]\\s*" +
                "(?:\"[^\"]*\"|'[^']*'|[^\\s,;&}]+)",
            "$1=<redacted>"
        );
        message = message.replaceAll(
            "(?i)\\brequest\\s+body\\s*[:=]\\s*[^\\r\\n]*",
            "request body=<redacted>"
        );
        return message.substring(0, Math.min(500, message.length()));
    }
}
