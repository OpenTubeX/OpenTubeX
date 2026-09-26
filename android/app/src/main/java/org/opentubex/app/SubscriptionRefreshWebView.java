package org.opentubex.app;

import android.content.Context;
import android.util.AttributeSet;

import com.getcapacitor.CapacitorWebView;

import java.lang.ref.WeakReference;

/** Keep media playback and active refreshes out of Chromium's hidden-page freezer. */
public final class SubscriptionRefreshWebView extends CapacitorWebView {
    private static WeakReference<SubscriptionRefreshWebView> activeView = new WeakReference<>(null);
    private static boolean playbackActive;

    private boolean refreshActive;
    private int actualWindowVisibility = VISIBLE;

    public SubscriptionRefreshWebView(Context context, AttributeSet attributes) {
        super(context, attributes);
        AndroidProxy.protectWebView(this);
        activeView = new WeakReference<>(this);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        actualWindowVisibility = visibility;
        super.onWindowVisibilityChanged(refreshActive || playbackActive ? VISIBLE : visibility);
    }

    void setRefreshActive(boolean active) {
        refreshActive = active;
        // This changes Chromium's lifecycle, not Android's window visibility.
        // Renderer UI behavior uses the actual activity state via appVisibility.
        updateVisibility();
    }

    static void setPlaybackActive(boolean active) {
        playbackActive = active;
        SubscriptionRefreshWebView view = activeView.get();
        if (view != null) view.updateVisibility();
    }

    private void updateVisibility() {
        super.onWindowVisibilityChanged(refreshActive || playbackActive ? VISIBLE : actualWindowVisibility);
    }
}
