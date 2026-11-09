package org.opentubex.app;

import android.annotation.SuppressLint;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.HttpAuthHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.Map;
import java.util.Objects;

@CapacitorPlugin(name = "PoToken")
public class PoTokenPlugin extends Plugin {
    private static final long GENERATE_TIMEOUT_MS = 30_000;
    /** BotGuard returns a longer token when it doesn't trust the attestation. */
    static final int MAX_ATTESTED_PO_TOKEN_LENGTH = 120;
    private static final Pattern EXPORT_PATTERN = Pattern.compile("export\\{(\\w+) as default\\};");
    private final SerialTaskQueue requestQueue = new SerialTaskQueue();
    private final Handler handler = new Handler(Looper.getMainLooper());

    /**
     * The view holding the current BotGuard attestation. A full BotGuard run
     * takes a second or more, while minting from an attestation takes
     * milliseconds, so later videos mint from it until it expires.
     */
    private WebView attestationView;
    private ProxyConfiguration attestationProxy;
    private long attestationExpiresAt;
    private Runnable expireAttestation;

    /** The view whose script result the current request waits for. */
    private WebView pendingView;
    private Result pendingResult;
    private final Runnable pendingTimeout = () -> settle(pendingView, null, 0, "PO token generation timed out");

    private interface Result {
        void resolve(String token, double validForSecs);
        void reject(String message);
    }

    static boolean isAttested(String token) {
        return token.length() <= MAX_ATTESTED_PO_TOKEN_LENGTH;
    }

    /** Whether later tokens can be minted from an attestation made on this route. */
    static boolean canMintFrom(long expiresAt, ProxyConfiguration attestedProxy, ProxyConfiguration currentProxy, long now) {
        return now < expiresAt && Objects.equals(attestedProxy, currentProxy);
    }

    /**
     * When to discard a new attestation, or 0 if it can't mint later tokens:
     * every token from an untrusted attestation is pending attestation too.
     */
    static long attestationExpiry(String token, long startedAt, double validForSecs, long now) {
        long expiresAt = startedAt + (long) (validForSecs * 1000);
        return isAttested(token) && expiresAt > now ? expiresAt : 0;
    }

    @PluginMethod
    public void generate(PluginCall call) {
        String videoId = call.getString("videoId");
        String sessionContext = call.getString("sessionContext");
        String initialAttestationData = call.getString("initialAttestationData");
        String ytConfig = call.getString("ytConfig");

        if (videoId == null || sessionContext == null || initialAttestationData == null || ytConfig == null) {
            call.reject("Missing PO token parameters");
            return;
        }

        getActivity().runOnUiThread(() -> requestQueue.enqueue(() -> {
            if (attestationView != null && !canMintFrom(
                attestationExpiresAt,
                attestationProxy,
                AndroidProxy.configuration(),
                System.currentTimeMillis()
            )) {
                discardAttestation();
            }

            if (attestationView != null) {
                mint(call, videoId, () -> attest(call, videoId, sessionContext, initialAttestationData, ytConfig));
            } else {
                attest(call, videoId, sessionContext, initialAttestationData, ytConfig);
            }
        }));
    }

    @Override
    protected void handleOnDestroy() {
        handler.removeCallbacks(pendingTimeout);
        if (pendingView != null && pendingView != attestationView) destroyView(pendingView);
        pendingView = null;
        pendingResult = null;
        discardAttestation();
        super.handleOnDestroy();
    }

    private void mint(PluginCall call, String videoId, Runnable onFailure) {
        WebView view = attestationView;
        await(view, new Result() {
            @Override
            public void resolve(String token, double validForSecs) {
                if (!isAttested(token)) discardAttestation();
                resolveCall(call, token);
            }

            @Override
            public void reject(String message) {
                discardAttestation();
                onFailure.run();
            }
        });
        view.evaluateJavascript(
            "window.ftMintPoToken(" + JSONObject.quote(videoId) + ")" +
                ".then(token=>OpenTubeXPoToken.resolve(token,0))" +
                ".catch(error=>OpenTubeXPoToken.reject(String(error)))",
            null
        );
    }

    private void attest(
        PluginCall call,
        String videoId,
        String sessionContext,
        String initialAttestationData,
        String ytConfig
    ) {
        String script;
        WebView view;
        try {
            script = createBotGuardScript(videoId, sessionContext, initialAttestationData, ytConfig);
            view = createBotGuardView();
        } catch (IOException | JSONException | RuntimeException exception) {
            call.reject("Failed to prepare PO token generation", exception);
            requestQueue.complete();
            return;
        }

        // The attestation's lifetime starts during this run, so count it from before
        long startedAt = System.currentTimeMillis();
        ProxyConfiguration proxy = AndroidProxy.configuration();
        await(view, new Result() {
            @Override
            public void resolve(String token, double validForSecs) {
                long now = System.currentTimeMillis();
                long expiresAt = attestationExpiry(token, startedAt, validForSecs, now);
                if (expiresAt > 0) {
                    attestationView = view;
                    attestationProxy = proxy;
                    attestationExpiresAt = expiresAt;
                    // Release the view once it expires, even if no other video needs a token
                    expireAttestation = () -> requestQueue.enqueue(() -> {
                        if (attestationView == view) discardAttestation();
                        requestQueue.complete();
                    });
                    handler.postDelayed(expireAttestation, expiresAt - now);
                } else {
                    destroyView(view);
                }
                resolveCall(call, token);
            }

            @Override
            public void reject(String message) {
                destroyView(view);
                call.reject(message);
                requestQueue.complete();
            }
        });

        try {
            String document = "<!doctype html><html><head><meta charset=\"UTF-8\"></head><body>" +
                "<script>" + script +
                ".then(token=>OpenTubeXPoToken.resolve(token,window.ftPoTokenValidForSecs||0))" +
                ".catch(error=>OpenTubeXPoToken.reject(String(error)))" +
                "</script></body></html>";
            view.loadDataWithBaseURL("https://www.youtube.com/", document, "text/html", "UTF-8", null);
        } catch (RuntimeException exception) {
            settle(view, null, 0, "Failed to prepare PO token generation: " + exception.getMessage());
        }
    }

    private void resolveCall(PluginCall call, String token) {
        JSObject result = new JSObject();
        result.put("token", token);
        try {
            call.resolve(result);
        } finally {
            requestQueue.complete();
        }
    }

    private void await(WebView view, Result result) {
        pendingView = view;
        pendingResult = result;
        handler.postDelayed(pendingTimeout, GENERATE_TIMEOUT_MS);
    }

    /** Ignores late results from a view the current request no longer waits for. */
    private void settle(WebView view, String token, double validForSecs, String error) {
        if (pendingResult == null || view != pendingView) return;
        Result result = pendingResult;
        pendingView = null;
        pendingResult = null;
        handler.removeCallbacks(pendingTimeout);
        if (error == null && (token == null || token.isEmpty())) error = "BotGuard returned no PO token";
        if (error == null) {
            result.resolve(token, validForSecs);
        } else {
            result.reject(error);
        }
    }

    private void discardAttestation() {
        if (expireAttestation != null) handler.removeCallbacks(expireAttestation);
        expireAttestation = null;
        if (attestationView == null) return;
        WebView view = attestationView;
        attestationView = null;
        attestationProxy = null;
        destroyView(view);
    }

    private static void destroyView(WebView view) {
        view.stopLoading();
        view.removeJavascriptInterface("OpenTubeXPoToken");
        view.destroy();
    }

    private String createBotGuardScript(
        String videoId,
        String sessionContext,
        String initialAttestationData,
        String ytConfig
    ) throws IOException, JSONException {
        String script;
        try (InputStream input = getContext().getAssets().open("public/botGuardScript.js");
             BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            StringBuilder builder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line).append('\n');
            }
            script = builder.toString();
        }

        Matcher exportMatcher = EXPORT_PATTERN.matcher(script);
        if (!exportMatcher.find()) {
            throw new IOException("BotGuard entry point was not found");
        }

        String invocation = String.format(
            ";%s(%s,%s,%s,%s)",
            exportMatcher.group(1),
            JSONObject.quote(videoId),
            new JSONObject(sessionContext),
            new JSONObject(initialAttestationData),
            new JSONObject(ytConfig)
        );
        return exportMatcher.replaceFirst(Matcher.quoteReplacement(invocation));
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private WebView createBotGuardView() {
        WebView view = new WebView(getContext());
        try {
            AndroidProxy.protectWebView(view);
            WebSettings settings = view.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            view.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void resolve(String token, double validForSecs) {
                    handler.post(() -> settle(view, token, validForSecs, null));
                }

                @JavascriptInterface
                public void reject(String message) {
                    handler.post(() -> settle(view, null, 0, String.valueOf(message)));
                }
            }, "OpenTubeXPoToken");
            view.setWebViewClient(new BotGuardWebViewClient());
            return view;
        } catch (RuntimeException exception) {
            view.destroy();
            throw exception;
        }
    }

    private static class BotGuardWebViewClient extends WebViewClient {
    @Override
    public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
        if (!AndroidProxy.answerProxyChallenge(handler, host, realm)) super.onReceivedHttpAuthRequest(view, handler, host, realm);
    }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String method = request.getMethod();

            if ("data".equals(uri.getScheme())) {
                return super.shouldInterceptRequest(view, request);
            }

            if (
                "POST".equals(method) &&
                "www.youtube.com".equals(uri.getHost()) &&
                ("/youtubei/v1/att/get".equals(uri.getPath()) ||
                    "/api/jnn/v1/GenerateIT".equals(uri.getPath()))
            ) {
                return super.shouldInterceptRequest(view, request);
            }

            if (
                "GET".equals(method) &&
                "https".equals(uri.getScheme()) &&
                "www.google.com".equals(uri.getHost()) &&
                uri.getPath() != null &&
                uri.getPath().startsWith("/js/")
            ) {
                return loadGoogleInterpreter(request);
            }

            return new WebResourceResponse(
                "text/plain",
                "UTF-8",
                403,
                "Forbidden",
                java.util.Collections.emptyMap(),
                new ByteArrayInputStream(new byte[0])
            );
        }

        private WebResourceResponse loadGoogleInterpreter(WebResourceRequest request) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) AndroidProxy.openConnection(new URL(request.getUrl().toString()));
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(15_000);
                for (java.util.Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                    connection.setRequestProperty(header.getKey(), header.getValue());
                }
                connection.setRequestProperty("Referer", "https://www.google.com/");
                connection.setRequestProperty("Origin", "https://www.google.com");
                connection.setRequestProperty("Sec-Fetch-Dest", "script");
                connection.setRequestProperty("Sec-Fetch-Site", "cross-site");
                connection.setRequestProperty("Accept-Language", "*");

                int status = connection.getResponseCode();
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (stream == null) stream = new ByteArrayInputStream(new byte[0]);

                Map<String, String> headers = AndroidHttpUtils.flattenHeaders(
                    connection.getHeaderFields()
                );
                headers.put("Access-Control-Allow-Origin", "*");

                return new WebResourceResponse(
                    AndroidHttpUtils.mimeType(
                        connection.getContentType(),
                        "application/javascript"
                    ),
                    null,
                    status,
                    connection.getResponseMessage() == null ? "" : connection.getResponseMessage(),
                    headers,
                    AndroidHttpUtils.disconnectOnClose(stream, connection)
                );
            } catch (IOException exception) {
                if (connection != null) connection.disconnect();
                return new WebResourceResponse(
                    "text/plain",
                    "UTF-8",
                    new ByteArrayInputStream(new byte[0])
                );
            }
        }
    }

}
