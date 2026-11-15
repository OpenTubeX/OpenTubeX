package org.opentubex.app;

import android.app.Presentation;
import android.content.Context;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;

/** Keeps a dismissed refresh attached without displaying it on the user's screen. */
final class SubscriptionRefreshDisplay implements AutoCloseable {
    private ImageReader images;
    private VirtualDisplay display;
    private Presentation presentation;
    private final WebView webView;

    SubscriptionRefreshDisplay(WebView webView) {
        this.webView = webView;
        Context context = webView.getContext();
        int width = Math.max(1, webView.getWidth());
        int height = Math.max(1, webView.getHeight());
        try {
            images = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
            images.setOnImageAvailableListener(reader -> {
                try (Image image = reader.acquireLatestImage()) {
                    // Drain the private surface so rendering cannot block on a full buffer.
                }
            }, new Handler(Looper.getMainLooper()));
            display = context.getSystemService(DisplayManager.class).createVirtualDisplay(
                "OpenTubeX subscription refresh", width, height,
                context.getResources().getDisplayMetrics().densityDpi,
                images.getSurface(), DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY
            );
            if (display == null) throw new IllegalStateException("Unable to create refresh display");
            presentation = new Presentation(context, display.getDisplay());
            presentation.getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
            );
            if (webView.getParent() instanceof ViewGroup parent) parent.removeView(webView);
            presentation.setContentView(webView);
            presentation.show();
        } catch (RuntimeException error) {
            close();
            throw error;
        }
    }

    @Override
    public void close() {
        if (presentation != null) {
            if (webView.getParent() instanceof ViewGroup parent) parent.removeView(webView);
            presentation.dismiss();
            presentation = null;
        }
        if (display != null) {
            display.release();
            display = null;
        }
        if (images != null) {
            images.close();
            images = null;
        }
    }
}
