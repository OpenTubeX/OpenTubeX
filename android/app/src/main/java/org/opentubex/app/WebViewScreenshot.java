package org.opentubex.app;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.view.PixelCopy;
import android.webkit.WebView;

import java.util.function.Consumer;

final class WebViewScreenshot {
    private WebViewScreenshot() {}

    static void capture(Activity activity, WebView webView, Consumer<Bitmap> success, Consumer<Exception> failure) {
        capture(activity, webView, 0, 1, webView.getWidth(), webView.getHeight(), success, failure);
    }

    static void capture(Activity activity, WebView webView, double top, double height,
                        int width, int targetHeight, Consumer<Bitmap> success, Consumer<Exception> failure) {
        if (!Double.isFinite(top) || !Double.isFinite(height) || top < 0 || height <= 0
                || top + height > 1.000001 || width <= 0 || targetHeight <= 0) {
            failure.accept(new IllegalArgumentException("Invalid screenshot dimensions"));
            return;
        }
        if (!webView.isAttachedToWindow() || webView.getWidth() <= 0 || webView.getHeight() <= 0) {
            failure.accept(new IllegalStateException("WebView is not ready for capture"));
            return;
        }
        int[] location = new int[2];
        webView.getLocationInWindow(location);
        Rect bounds = new Rect(location[0], location[1] + (int) Math.floor(top * webView.getHeight()),
            location[0] + webView.getWidth(), location[1] + (int) Math.ceil(Math.min(1, top + height) * webView.getHeight()));
        Bitmap bitmap = Bitmap.createBitmap(width, targetHeight, Bitmap.Config.ARGB_8888);
        try {
            // Software WebView.draw can scale individual compositor layers
            // differently on recent Chromium versions. Copy the rendered pixels.
            PixelCopy.request(activity.getWindow(), bounds, bitmap, result -> {
                if (result == PixelCopy.SUCCESS) {
                    success.accept(bitmap);
                } else {
                    bitmap.recycle();
                    failure.accept(new IllegalStateException("PixelCopy failed: " + result));
                }
            }, new Handler(Looper.getMainLooper()));
        } catch (IllegalArgumentException error) {
            bitmap.recycle();
            failure.accept(error);
        }
    }
}
