package org.opentubex.app;

import android.content.Context;
import android.util.AtomicFile;
import android.util.Log;
import android.webkit.HttpAuthHandler;
import android.webkit.WebView;
import com.getcapacitor.JSObject;

import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;
import androidx.webkit.WebViewFeature;
import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.Authenticator;
import java.net.InetSocketAddress;
import java.net.MalformedURLException;
import java.net.PasswordAuthentication;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.SocketAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/** Installed before activities and background workers can send requests. */
final class AndroidProxy {
    private static final String TAG = "AndroidProxy";
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
            JSONObject saved = new JSONObject(new String(settings.readFully(), StandardCharsets.UTF_8));
            boolean rewrite = decryptPassword(saved);
            configuration = configuration(saved);
            if (rewrite) {
                try {
                    write(saved);
                } catch (Exception error) {
                    Log.e(TAG, "Unable to save the proxy settings", error);
                }
            }
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
                    // The relay refuses loopback destinations, and their traffic never leaves
                    // the device, so a server on this device is reached directly. Only literals
                    // and "localhost" itself qualify: DNS resolves other *.localhost names.
                    String host = uri.getHost() == null ? "" : uri.getHost().replace("[", "").replace("]", "");
                    String name = host.toLowerCase(Locale.ROOT).replaceFirst("\\.$", "");
                    boolean direct = name.equals("localhost") ||
                        (!name.endsWith(".localhost") && AndroidProxyRelay.isLoopbackName(name));
                    return Collections.singletonList(direct ? Proxy.NO_PROXY : local);
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

    /** Call on the main thread for every WebView the app creates. */
    static void protectWebView(WebView view) {
        WebViewNetworkState.attach(view);
        boolean ready = webViewReady.isDone() && !webViewReady.isCompletedExceptionally();
        view.getSettings().setBlockNetworkLoads(!ready);
        if (!webViewReady.isDone()) waitingViews.add(view);
    }

    static CompletableFuture<Void> ready() { return webViewReady; }

    static String url() {
        if (relay == null) throw new IllegalStateException("Android proxy has not initialized");
        return relay.url();
    }

    /** Whether the app's or Android's proxy carries requests to this target. */
    static boolean proxies(URI target) {
        if (relay == null) throw new IllegalStateException("Android proxy has not initialized");
        return relay.proxies(target);
    }

    /**
     * Closes the relay's tunnels that carried no data since {@code since}, from
     * {@link AndroidProxyRelay#clock}, and for at least a minute. That is longer
     * than a sync long poll waits silently, and replies still on their way
     * survive a quick switch to another app.
     */
    static void closeStaleTunnels(long since) {
        if (relay != null) relay.closeTunnelsIdleSince(Math.min(since, AndroidProxyRelay.clock.getAsLong() - TimeUnit.MINUTES.toNanos(1)));
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
        try {
            write(value);
            configuration = next;
        } catch (Exception error) {
            relay.configure(new ProxyConfiguration(true, "invalid", "", "0", "", ""));
            throw error;
        }
    }

    /**
     * Decrypts the saved password into {@code password}. One this installation
     * cannot decrypt, such as one restored from another device, is left empty,
     * so the user enters it again.
     * @return whether the settings need to be saved again: to encrypt a password
     *     an earlier version saved, or to delete one that cannot be decrypted
     */
    static boolean decryptPassword(JSONObject saved) throws JSONException {
        String encrypted = saved.optString("encryptedPassword", "");
        if (encrypted.isEmpty()) return !saved.optString("password", "").isEmpty();
        String password = null;
        boolean rewrite = false;
        try {
            password = SecretStorage.decrypt(encrypted);
            if (password == null) {
                Log.w(TAG, "Deleting the saved proxy password, which cannot be decrypted on this device");
                rewrite = true;
            }
        } catch (Exception error) {
            // The next start tries again.
            Log.e(TAG, "Unable to decrypt the saved proxy password", error);
        }
        saved.put("password", password == null ? "" : password);
        return rewrite;
    }

    /** Saves the settings with the password encrypted, or as it is when the Keystore fails. */
    private static void write(JSONObject value) throws Exception {
        JSONObject saved = new JSONObject(value.toString());
        String password = saved.optString("password", "");
        saved.remove("encryptedPassword");
        if (!password.isEmpty()) {
            try {
                saved.put("encryptedPassword", SecretStorage.encrypt(password));
                saved.remove("password");
            } catch (Exception error) {
                Log.e(TAG, "Unable to encrypt the proxy password, saving it unencrypted", error);
            }
        }
        FileOutputStream output = null;
        try {
            output = settings.startWrite();
            output.write(saved.toString().getBytes(StandardCharsets.UTF_8));
            settings.finishWrite(output);
        } catch (IOException error) {
            settings.failWrite(output);
            throw error;
        }
    }

    /**
     * Opens a connection through the proxy ProxySelector picks for it. Once every
     * selected proxy fails, HttpURLConnection tries a direct connection, which would
     * bypass the app's proxy and add a second DNS lookup and connect timeout to an
     * outage. An explicit proxy has no such fallback.
     */
    static URLConnection openConnection(URL url) throws IOException {
        ProxySelector selector = ProxySelector.getDefault();
        List<Proxy> proxies;
        try {
            proxies = selector == null ? null : selector.select(url.toURI());
        } catch (URISyntaxException error) {
            throw new MalformedURLException(error.getMessage());
        }
        return url.openConnection(proxies == null || proxies.isEmpty() ? Proxy.NO_PROXY : proxies.get(0));
    }

    /** The current routing policy. A BotGuard attestation is bound to the route it was made on. */
    static synchronized ProxyConfiguration configuration() { return configuration; }

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
