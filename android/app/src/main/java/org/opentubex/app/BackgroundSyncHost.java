package org.opentubex.app;

import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.webkit.JavascriptInterface;

import androidx.appcompat.app.AppCompatActivity;

import com.getcapacitor.CapacitorWebView;

/**
 * Stands in for the activity that a Capacitor bridge requires, so the renderer
 * can sync while the app is closed. A worker cannot start an activity, so
 * Android never creates or shows this one: it has no window, and the
 * application context serves as its base context.
 */
final class BackgroundSyncHost extends AppCompatActivity {
    /**
     * The renderer checks for this object to tell that it runs out of view. It
     * also tells whether the app bundles yt-dlp, as the renderer otherwise tells
     * from the plugin, which this renderer leaves out.
     */
    static final String MARKER_INTERFACE = "OpenTubeXBackgroundSync";

    private final CapacitorWebView webView;

    BackgroundSyncHost(Context context) {
        Context application = context.getApplicationContext();
        attachBaseContext(application);
        setIntent(new Intent(Intent.ACTION_MAIN));
        webView = new HiddenWebView(application);
        // Added before the bridge loads the page, which an interface added
        // later would only reach after a reload.
        webView.addJavascriptInterface(new Marker(), MARKER_INTERFACE);
    }

    /** Capacitor's bridge builder looks up the WebView in the activity's layout. */
    @Override
    @SuppressWarnings("unchecked")
    public <T extends View> T findViewById(int id) {
        return id == com.getcapacitor.android.R.id.webview ? (T) webView : null;
    }

    private static final class Marker {
        @JavascriptInterface
        public boolean bundlesYtDlp() {
            return BuildConfig.BUNDLES_YT_DLP;
        }
    }

    /** Never attached to a window, so Chromium would treat the page as hidden and throttle its timers. */
    private static final class HiddenWebView extends CapacitorWebView {
        HiddenWebView(Context context) {
            super(context, null);
            AndroidProxy.protectWebView(this);
            onWindowVisibilityChanged(VISIBLE);
        }
    }
}
