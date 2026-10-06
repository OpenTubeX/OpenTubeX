package org.opentubex.app;

import com.getcapacitor.JSObject;
import okhttp3.HttpUrl;
import okhttp3.Request;

/** Private-instance credentials stay on upstream requests in their original scope. */
final class DlnaAuthorization {
    private final HttpUrl instance;
    private final String path;
    private final String value;

    DlnaAuthorization(JSObject options) {
        instance = HttpUrl.parse(options.getString("url", ""));
        value = options.getString("value", "");
        if (instance == null || !instance.username().isEmpty() || !instance.password().isEmpty() ||
            value.isEmpty() || value.length() > 4096 || value.contains("\r") || value.contains("\n")) {
            throw new IllegalArgumentException("Invalid DLNA authorization");
        }
        path = instance.encodedPath().replaceAll("/+$", "");
    }

    boolean contains(HttpUrl url) {
        return instance.scheme().equals(url.scheme()) && instance.host().equals(url.host()) &&
            instance.port() == url.port() && (url.encodedPath().equals(path) || url.encodedPath().startsWith(path + "/"));
    }

    void apply(Request.Builder request, HttpUrl source, HttpUrl destination) {
        if (contains(source) && contains(destination)) request.header("Authorization", value);
    }
}
