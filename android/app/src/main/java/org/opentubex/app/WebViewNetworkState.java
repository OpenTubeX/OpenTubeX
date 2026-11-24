package org.opentubex.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import java.util.Collections;
import java.util.Set;
import java.util.WeakHashMap;

/**
 * Sets navigator.onLine from Android's default network.
 *
 * Chromium's own detection can keep reporting a working network as lost until
 * the next network change, for example after the app spent hours in the
 * background while the device switched networks. The renderer then waits for
 * a network that is already there. Setting the state from the app turns that
 * detection off (see WebView#setNetworkAvailable). The app reaches the
 * internet only through AndroidProxyRelay, which resolves and connects on its
 * own, so Chromium's network stack needs no network changes.
 */
final class WebViewNetworkState {
    // Accessed on the main thread only.
    private static final Set<WebView> views = Collections.newSetFromMap(new WeakHashMap<>());
    private static ConnectivityManager.NetworkCallback callback;
    private static Network network;
    /** Null until Android reports the default network; Chromium's state applies until then. */
    private static Boolean available;

    private WebViewNetworkState() {}

    /** Call on the main thread for every WebView that runs the app. */
    static void attach(WebView view) {
        views.add(view);
        if (callback == null) register(view.getContext().getApplicationContext());
        if (available != null) view.setNetworkAvailable(available);
    }

    /** Applies the state again, for a renderer that restarted with Chromium's state. */
    static void refresh() {
        if (available == null) return;
        for (WebView view : views) view.setNetworkAvailable(available);
    }

    private static void register(Context context) {
        callback = new ConnectivityManager.NetworkCallback() {
            // Blocked status is ignored on purpose: Android blocks only a hidden
            // app, and the renderer already tells those failures from an outage.
            @Override
            public void onCapabilitiesChanged(Network changed, NetworkCapabilities capabilities) {
                network = changed;
                update(capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET));
            }

            @Override
            public void onLost(Network lost) {
                if (!lost.equals(network)) return;
                network = null;
                update(false);
            }
        };
        context.getSystemService(ConnectivityManager.class)
            .registerDefaultNetworkCallback(callback, new Handler(Looper.getMainLooper()));
    }

    private static void update(boolean value) {
        if (Boolean.valueOf(value).equals(available)) return;
        available = value;
        refresh();
    }
}
