package org.opentubex.app;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.DataOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

public class OpenTubeXWebViewClient extends BridgeWebViewClient {
    private static final Pattern CONTENT_RANGE = Pattern.compile("bytes ([0-9]+)-([0-9]+)/", Pattern.CASE_INSENSITIVE);
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;
    private final SabrRequestRegistry sabrRequests;
    private final ExternalStreamRequestRegistry externalStreams;
    private final okhttp3.OkHttpClient externalStreamClient;

    public OpenTubeXWebViewClient(Bridge bridge) {
        super(bridge);
        sabrRequests = SabrRequestRegistry.shared();
        externalStreams = ExternalStreamRequestRegistry.shared();
        externalStreamClient = ExternalStreamRedirects.client().newBuilder()
            .addInterceptor(new RumbleManifestTransport(bridge.getContext())).build();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        URL url;
        try {
            url = new URL(request.getUrl().toString());
        } catch (Exception exception) {
            return super.shouldInterceptRequest(view, request);
        }

        if (url.getPath().startsWith("/_opentubex_sabr/")) {
            return interceptSabrRequest(url, request);
        }

        Map<String, String> streamHeaders = externalStreams.headersFor(url);
        String host = url.getHost();
        boolean googleVideo = "https".equals(url.getProtocol()) &&
            ("googlevideo.com".equals(host) || host.endsWith(".googlevideo.com"));
        if (!googleVideo && streamHeaders == null) {
            return super.shouldInterceptRequest(view, request);
        }

        if ("OPTIONS".equals(request.getMethod())) {
            return new WebResourceResponse(
                "text/plain",
                "UTF-8",
                204,
                "No Content",
                corsHeaders(),
                new ByteArrayInputStream(new byte[0])
            );
        }

        if (!"GET".equals(request.getMethod()) && !"HEAD".equals(request.getMethod())) {
            return super.shouldInterceptRequest(view, request);
        }
        if (streamHeaders != null) {
            return interceptExternalStream(request, streamHeaders,
                externalStreams.isHttpStoryboardUrl(url) || externalStreams.isTwitchVodPath(url));
        }

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod(request.getMethod());
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                connection.setRequestProperty(header.getKey(), header.getValue());
            }

            int statusCode = connection.getResponseCode();
            InputStream stream = statusCode >= 400
                ? connection.getErrorStream()
                : connection.getInputStream();
            if (stream == null) {
                stream = new ByteArrayInputStream(new byte[0]);
            }

            Map<String, String> responseHeaders = AndroidHttpUtils.flattenHeaders(
                connection.getHeaderFields()
            );
            String responseMessage = connection.getResponseMessage();
            return mediaResponse(
                request,
                AndroidHttpUtils.mimeType(connection.getContentType(), "application/octet-stream"),
                statusCode,
                responseMessage == null ? "" : responseMessage,
                responseHeaders,
                AndroidHttpUtils.disconnectOnClose(stream, connection)
            );
        } catch (IOException exception) {
            if (connection != null) {
                connection.disconnect();
            }
            return super.shouldInterceptRequest(view, request);
        }
    }

    private WebResourceResponse interceptExternalStream(WebResourceRequest webRequest,
                                                         Map<String, String> streamHeaders,
                                                         boolean stripCookies) {
        Request.Builder builder = new Request.Builder().url(webRequest.getUrl().toString())
            .method(webRequest.getMethod(), null);
        for (Map.Entry<String, String> header : webRequest.getRequestHeaders().entrySet()) {
            if (stripCookies && "cookie".equalsIgnoreCase(header.getKey())) continue;
            builder.header(header.getKey(), header.getValue());
        }
        for (Map.Entry<String, String> header : streamHeaders.entrySet()) {
            builder.header(header.getKey(), header.getValue());
        }

        try {
            Response response = ExternalStreamRedirects.fetchForWebView(builder.build(), externalStreamClient);
            int statusCode = response.code();
            if (statusCode >= 300 && statusCode < 400) {
                // WebResourceResponse rejects every 3xx code, including 304.
                if (response.body() != null) response.close();
                return errorResponse(502, "Bad Gateway");
            }
            ResponseBody body = response.body();
            InputStream stream = body == null ? new ByteArrayInputStream(new byte[0]) : body.byteStream();
            Map<String, String> responseHeaders = AndroidHttpUtils.flattenHeaders(response.headers().toMultimap());
            String responseMessage = response.message();
            if (responseMessage == null || responseMessage.isEmpty()) responseMessage = "HTTP " + statusCode;
            return mediaResponse(
                webRequest,
                AndroidHttpUtils.mimeType(response.header("Content-Type"), "application/octet-stream"),
                statusCode, responseMessage, responseHeaders,
                new FilterInputStream(stream) {
                    @Override public void close() throws IOException {
                        try { super.close(); } finally { if (body != null) response.close(); }
                    }
                }
            );
        } catch (IOException error) {
            return errorResponse(502, "Bad Gateway");
        }
    }

    private WebResourceResponse interceptSabrRequest(
        URL proxyUrl,
        WebResourceRequest webRequest
    ) {
        String requestId = SabrRequestRegistry.requestIdFromProxyUrl(proxyUrl);
        if (requestId == null) {
            return errorResponse(404, "Not Found");
        }
        if (!"GET".equals(webRequest.getMethod())) {
            return errorResponse(405, "Method Not Allowed");
        }

        SabrRequestRegistry.PreparedRequest request = sabrRequests.consume(requestId);
        if (request == null) {
            return errorResponse(404, "Not Found");
        }

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) request.url().openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(false);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(request.body().length);
            for (Map.Entry<String, String> header : request.headers().entrySet()) {
                connection.setRequestProperty(header.getKey(), header.getValue());
            }

            if (!sabrRequests.activate(request, connection)) {
                return errorResponse(410, "Gone");
            }

            try (DataOutputStream output = new DataOutputStream(connection.getOutputStream())) {
                output.write(request.body());
            }

            int statusCode = connection.getResponseCode();
            InputStream stream = statusCode >= 400
                ? connection.getErrorStream()
                : connection.getInputStream();
            if (stream == null) {
                stream = new ByteArrayInputStream(new byte[0]);
            }

            Map<String, String> responseHeaders = AndroidHttpUtils.flattenHeaders(
                connection.getHeaderFields()
            );
            String responseMessage = connection.getResponseMessage();

            return new WebResourceResponse(
                AndroidHttpUtils.mimeType(
                    connection.getContentType(),
                    "application/vnd.yt-ump"
                ),
                null,
                statusCode,
                responseMessage == null ? "Unknown" : responseMessage,
                responseHeaders,
                AndroidHttpUtils.disconnectOnClose(
                    stream,
                    connection,
                    () -> sabrRequests.complete(request)
                )
            );
        } catch (IOException exception) {
            if (connection != null) {
                connection.disconnect();
            }
            sabrRequests.complete(request);
            return errorResponse(502, "Bad Gateway");
        }
    }

    static WebResourceResponse mediaResponse(WebResourceRequest request, String mimeType,
                                             int statusCode, String responseMessage,
                                             Map<String, String> headers, InputStream stream) {
        // WebView adds Content-Type from WebResourceResponse's MIME type.
        // Supplying it again produces an invalid "video/mp4, video/mp4".
        removeHeader(headers, "Content-Type");
        for (Map.Entry<String, String> header : corsHeaders().entrySet()) {
            removeHeader(headers, header.getKey());
            headers.put(header.getKey(), header.getValue());
        }
        if (statusCode == HttpURLConnection.HTTP_PARTIAL && headerValue(request.getRequestHeaders(), "Range") == null) {
            // Keep Shaka's query-ranged responses opaque. Native media needs
            // the original range headers to load and seek.
            statusCode = HttpURLConnection.HTTP_OK;
            responseMessage = "OK";
            removeHeader(headers, "Accept-Ranges");
            removeHeader(headers, "Content-Length");
            removeHeader(headers, "Content-Range");
        }
        if (statusCode == HttpURLConnection.HTTP_PARTIAL) {
            String contentRange = headerValue(headers, "Content-Range");
            Matcher range = CONTENT_RANGE.matcher(contentRange == null ? "" : contentRange);
            if (range.find()) {
                try {
                    stream = AndroidHttpUtils.alreadyRangedStream(stream,
                        Long.parseLong(range.group(1)), Long.parseLong(range.group(2)));
                } catch (NumberFormatException ignored) { /* Invalid upstream range. */ }
            }
        }
        return new WebResourceResponse(mimeType, null, statusCode, responseMessage, headers, stream);
    }

    private static String headerValue(Map<String, String> headers, String name) {
        for (Map.Entry<String, String> header : headers.entrySet()) {
            if (name.equalsIgnoreCase(header.getKey())) return header.getValue();
        }
        return null;
    }

    private static WebResourceResponse errorResponse(int status, String reason) {
        return new WebResourceResponse(
            "text/plain",
            "UTF-8",
            status,
            reason,
            Map.of("Cache-Control", "no-store"),
            new ByteArrayInputStream(new byte[0])
        );
    }

    private static Map<String, String> corsHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        headers.put("Access-Control-Allow-Headers", "Range");
        headers.put("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range");
        return headers;
    }

    private static void removeHeader(Map<String, String> headers, String name) {
        headers.keySet().removeIf(key -> key.equalsIgnoreCase(name));
    }
}
