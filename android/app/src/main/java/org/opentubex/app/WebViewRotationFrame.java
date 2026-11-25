package org.opentubex.app;

import android.view.ViewTreeObserver;
import android.webkit.WebView;

/** Keeps the old window buffer until Chromium has drawn the resized viewport. */
final class WebViewRotationFrame implements ViewTreeObserver.OnPreDrawListener, Runnable {
    private final WebView webView;
    private final ViewTreeObserver observer;
    private final boolean waitForRotation;
    private boolean requested;
    private boolean finished;

    WebViewRotationFrame(WebView webView) {
        this(webView, false);
    }

    WebViewRotationFrame(WebView webView, boolean waitForRotation) {
        this.webView = webView;
        this.waitForRotation = waitForRotation;
        observer = webView.getViewTreeObserver();
        observer.addOnPreDrawListener(this);
        webView.invalidate();
        // A denied rotation or suspended renderer must never freeze the app.
        webView.postDelayed(this, 500);
    }

    @Override
    public boolean onPreDraw() {
        if (finished) return true;
        if (waitForRotation) return false;
        if (!requested) {
            requested = true;
            // Layout must reach WebView before asking Chromium for the new frame.
            webView.postVisualStateCallback(0, new WebView.VisualStateCallback() {
                @Override
                public void onComplete(long requestId) {
                    run();
                }
            });
        }
        return false;
    }

    @Override
    public void run() {
        if (finished) return;
        finished = true;
        webView.removeCallbacks(this);
        if (observer.isAlive()) observer.removeOnPreDrawListener(this);
        webView.invalidate();
    }
}
