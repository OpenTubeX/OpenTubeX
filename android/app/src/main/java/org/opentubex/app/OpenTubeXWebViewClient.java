package org.opentubex.app;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

public class OpenTubeXWebViewClient extends BridgeWebViewClient {
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;
    private final SabrRequestRegistry sabrRequests;

    public OpenTubeXWebViewClient(Bridge bridge) {
        super(bridge);
        sabrRequests = SabrRequestRegistry.shared();
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

        String host = url.getHost();
        if (!"https".equals(url.getProtocol()) ||
            !("googlevideo.com".equals(host) || host.endsWith(".googlevideo.com"))) {
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
            responseHeaders.putAll(corsHeaders());

            String responseMessage = connection.getResponseMessage();
            if (statusCode == HttpURLConnection.HTTP_PARTIAL) {
                // WebView applies the request's Range offset again when an
                // intercepted response is marked as 206. The stream already
                // contains exactly the requested slice, so expose it as an
                // opaque successful response instead.
                statusCode = HttpURLConnection.HTTP_OK;
                responseMessage = "OK";
                removeHeader(responseHeaders, "Accept-Ranges");
                removeHeader(responseHeaders, "Content-Length");
                removeHeader(responseHeaders, "Content-Range");
            }

            return new WebResourceResponse(
                AndroidHttpUtils.mimeType(connection.getContentType(), "application/octet-stream"),
                null,
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
