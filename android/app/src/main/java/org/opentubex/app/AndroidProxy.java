package org.opentubex.app;

import android.content.Context;
import android.util.AtomicFile;
import android.webkit.HttpAuthHandler;
import android.webkit.WebView;
import com.getcapacitor.JSObject;

import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;
import androidx.webkit.WebViewFeature;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.Authenticator;
import java.net.InetSocketAddress;
import java.net.PasswordAuthentication;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.SocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/** Installed before activities and background workers can send requests. */
final class AndroidProxy {
    private static AndroidProxyRelay relay;
    private static AtomicFile settings;
    private static ProxyConfiguration configuration;
    private static final CompletableFuture<Void> webViewReady = new CompletableFuture<>();
    private static final List<WebView> waitingViews = new ArrayList<>();

    private AndroidProxy() {}

    static void initialize(Context context) {
        settings = new AtomicFile(new File(context.getNoBackupFilesDir(), "proxy.json"));
        try {
            // AtomicFile restores its backup in openRead, even if the base file
            // disappeared during an interrupted write on older Android versions.
            configuration = configuration(new JSONObject(new String(settings.readFully(), StandardCharsets.UTF_8)));
        } catch (FileNotFoundException error) {
            File base = settings.getBaseFile();
            boolean incompleteWrite = base.exists() || new File(base + ".bak").exists() || new File(base + ".new").exists();
            configuration = incompleteWrite
                ? new ProxyConfiguration(true, "invalid", "", "0", "", "")
                : new ProxyConfiguration(false, "socks5", "127.0.0.1", "9050", "", "");
        } catch (Exception error) {
            // Corrupt settings must not turn an enabled proxy into a direct connection.
            configuration = new ProxyConfiguration(true, "invalid", "", "0", "", "");
        }
        ProxySelector systemSelector = ProxySelector.getDefault();
        try {
            relay = new AndroidProxyRelay(configuration, systemSelector);
        } catch (IOException error) {
            throw new IllegalStateException("Unable to start the app network proxy", error);
        }
        Proxy local = new Proxy(Proxy.Type.HTTP, new InetSocketAddress("127.0.0.1", relay.port()));
        // URLConnection answers the relay's 407; OkHttp clients use proxyAuthenticator().
        Authenticator.setDefault(new Authenticator() {
            @Override protected PasswordAuthentication getPasswordAuthentication() {
                // Android may report the relay's host name as "localhost", so compare its address.
                return getRequestorType() == RequestorType.PROXY && getRequestingSite() != null &&
                    getRequestingSite().isLoopbackAddress() && getRequestingPort() == relay.port() &&
                    AndroidProxyRelay.REALM.equals(getRequestingPrompt()) &&
                    ("http".equals(getRequestingProtocol()) ||
                        AndroidProxyRelay.isUrlConnectionTunnelChallenge(Thread.currentThread().getStackTrace()))
                    ? new PasswordAuthentication(AndroidProxyRelay.USER, relay.password().toCharArray())
                    : null;
            }
        });
        ProxySelector.setDefault(new ProxySelector() {
            @Override public List<Proxy> select(URI uri) {
                if ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) {
                    return Collections.singletonList(local);
                }
                return systemSelector == null ? Collections.singletonList(Proxy.NO_PROXY) : systemSelector.select(uri);
            }
            @Override public void connectFailed(URI uri, SocketAddress address, IOException error) {
                // Deliberately no DIRECT candidate, even when the relay cannot be reached.
            }
        });
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
            webViewReady.completeExceptionally(new IllegalStateException("Android System WebView does not support proxy overrides"));
            return;
        }
        ProxyController.getInstance().setProxyOverride(new ProxyConfig.Builder()
            .addProxyRule(relay.url()).removeImplicitRules().build(), ContextCompat.getMainExecutor(context), () -> {
                for (WebView view : waitingViews) view.getSettings().setBlockNetworkLoads(false);
                waitingViews.clear();
                webViewReady.complete(null);
            });
    }

    static void protectWebView(WebView view) {
        boolean ready = webViewReady.isDone() && !webViewReady.isCompletedExceptionally();
        view.getSettings().setBlockNetworkLoads(!ready);
        if (!webViewReady.isDone()) waitingViews.add(view);
    }

    static CompletableFuture<Void> ready() { return webViewReady; }

    static String url() {
        if (relay == null) throw new IllegalStateException("Android proxy has not initialized");
        return relay.url();
    }

    static String connectionHost(URI target) {
        return relay.connectionHost(target);
    }

    /** For child processes, which send the credentials in the proxy URL. */
    static String authenticatedUrl() {
        if (relay == null) throw new IllegalStateException("Android proxy has not initialized");
        return relay.authenticatedUrl();
    }

    /** Also answers CONNECT preemptively, so tunnels need no extra round trip. */
    static okhttp3.Authenticator proxyAuthenticator() {
        return (route, response) -> relay == null ? null : relay.okHttpAuthenticator().authenticate(route, response);
    }

    /** The relay refuses loopback destinations, so only it can challenge as 127.0.0.1. */
    static boolean answerProxyChallenge(HttpAuthHandler handler, String host, String realm) {
        if (relay == null || !"127.0.0.1".equals(host) || !AndroidProxyRelay.REALM.equals(realm)) return false;
        handler.proceed(AndroidProxyRelay.USER, relay.password());
        return true;
    }

    static synchronized void configure(JSONObject value) throws Exception {
        ProxyConfiguration next = configuration(value);
        // Apply even invalid enabled input as a blocking policy while the user edits it.
        // Never retain an old direct route after the enable switch has been turned on.
        relay.configure(next);
        FileOutputStream output = null;
        try {
            output = settings.startWrite();
            output.write(value.toString().getBytes(StandardCharsets.UTF_8));
            settings.finishWrite(output);
            configuration = next;
        } catch (IOException error) {
            settings.failWrite(output);
            relay.configure(new ProxyConfiguration(true, "invalid", "", "0", "", ""));
            throw error;
        }
    }

    static synchronized JSObject getConfiguration() {
        return new JSObject().put("enabled", configuration.enabled)
            .put("protocol", configuration.protocol).put("hostname", configuration.hostname)
            .put("port", Integer.toString(configuration.port))
            .put("username", configuration.username).put("password", configuration.password);
    }

    private static ProxyConfiguration configuration(JSONObject value) {
        if (!(value.opt("enabled") instanceof Boolean enabled)) {
            throw new IllegalArgumentException("Missing proxy enabled state");
        }
        return new ProxyConfiguration(enabled, value.optString("protocol", "socks5"),
            value.optString("hostname", "127.0.0.1"), value.optString("port", "9050"),
            value.optString("username", ""), value.optString("password", ""));
    }
}
