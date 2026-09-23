package org.opentubex.app;

import java.io.IOException;
import java.net.URL;
import java.util.Map;

import okhttp3.Headers;
import okhttp3.HttpUrl;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Follows external stream redirects without carrying source credentials to a new origin. */
final class ExternalStreamRedirects implements Interceptor {
    private static final int MAX_REDIRECTS = 5;
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .addInterceptor(new ExternalStreamRedirects())
        .build();

    static OkHttpClient client() { return CLIENT; }

    static Response fetchForWebView(Request request) throws IOException {
        Response response = CLIENT.newCall(request).execute();
        if (response.code() != 304 || (request.header("If-None-Match") == null &&
            request.header("If-Modified-Since") == null)) return response;
        if (response.body() != null) response.close();
        Request unconditional = request.newBuilder()
            .removeHeader("If-None-Match")
            .removeHeader("If-Modified-Since")
            .build();
        return CLIENT.newCall(unconditional).execute();
    }

    @Override public Response intercept(Chain chain) throws IOException {
        Request request = chain.request();
        URL original = request.url().url();
        for (int redirects = 0; ; redirects++) {
            Response response = chain.proceed(request);
            if (!isRedirect(response.code()) || redirects == MAX_REDIRECTS) return response;
            String location = response.header("Location");
            HttpUrl destination = location == null ? null : request.url().resolve(location);
            if (destination == null || !"http".equals(destination.scheme()) &&
                !"https".equals(destination.scheme())) return response;
            Map<String, String> scoped = ExternalStreamRequestRegistry.shared()
                .headersForRedirect(original, destination.url());
            if (scoped == null) return response;

            Headers.Builder headers = new Headers.Builder();
            for (String name : new String[] { "Range", "If-Range", "Accept-Encoding" }) {
                String value = request.header(name);
                if (value != null) headers.add(name, value);
            }
            for (Map.Entry<String, String> header : scoped.entrySet()) {
                headers.set(header.getKey(), header.getValue());
            }
            request = request.newBuilder().url(destination).headers(headers.build()).build();
            if (response.body() != null) response.close();
        }
    }

    private static boolean isRedirect(int status) {
        return status == 301 || status == 302 || status == 303 || status == 307 || status == 308;
    }
}
