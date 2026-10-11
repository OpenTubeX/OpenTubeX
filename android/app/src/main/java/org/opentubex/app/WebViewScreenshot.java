package org.opentubex.app;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.FrameMetrics;
import android.view.PixelCopy;
import android.view.ViewTreeObserver;
import android.view.Window;
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
        // Revealing a prewarmed tab updates the DOM before Chromium submits its
        // pixels. Wait for that visual state and a committed frame before copying.
        webView.postVisualStateCallback(0, new WebView.VisualStateCallback() {
            @Override public void onComplete(long requestId) {
                awaitCommittedFrame(activity, webView, () -> copyRendered(
                    activity, webView, top, height, width, targetHeight, success, failure
                ), failure);
            }
        });
    }

    private static void awaitCommittedFrame(Activity activity, WebView webView,
                                            Runnable ready, Consumer<Exception> failure) {
        if (!webView.isAttachedToWindow() || !webView.isHardwareAccelerated()) {
            failure.accept(new IllegalStateException("WebView is not ready for hardware capture"));
            return;
        }
        Handler handler = new Handler(Looper.getMainLooper());
        // Both completion signals run on the main thread. A timeout also removes
        // listeners when a hidden or detached window stops submitting frames.
        class FrameWait implements Runnable {
            boolean completed;
            Runnable cleanup;
            final Runnable timeout = () -> {
                if (finish()) {
                    failure.accept(new IllegalStateException("Timed out waiting for a committed frame"));
                }
            };

            boolean finish() {
                if (completed) return false;
                completed = true;
                handler.removeCallbacks(timeout);
                cleanup.run();
                return true;
            }

            @Override public void run() {
                if (finish()) ready.run();
            }
        }
        FrameWait wait = new FrameWait();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ViewTreeObserver observer = webView.getViewTreeObserver();
            wait.cleanup = () -> {
                if (observer.isAlive()) observer.unregisterFrameCommitCallback(wait);
            };
            observer.registerFrameCommitCallback(wait);
        } else {
            Window window = activity.getWindow();
            long afterVisualState = System.nanoTime();
            // API 26–28 reports frame metrics after buffer submission. Ignore
            // queued reports for frames that began before the visual state barrier.
            Window.OnFrameMetricsAvailableListener listener = (source, metrics, dropped) -> {
                if (wait.completed) return;
                // RenderThread-only animations have no UI draw timestamps.
                long drawDuration = metrics.getMetric(FrameMetrics.DRAW_DURATION);
                if (metrics.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP) >= afterVisualState
                        && drawDuration > 0 && drawDuration <= metrics.getMetric(FrameMetrics.TOTAL_DURATION)
                        && metrics.getMetric(FrameMetrics.SWAP_BUFFERS_DURATION) > 0) {
                    wait.run();
                } else {
                    // Invalidation may have joined an already-started frame.
                    // Request another draw rather than waiting on an idle window.
                    webView.postInvalidateOnAnimation();
                }
            };
            wait.cleanup = () -> window.removeOnFrameMetricsAvailableListener(listener);
            window.addOnFrameMetricsAvailableListener(listener, handler);
        }
        handler.postDelayed(wait.timeout, 2000);
        webView.postInvalidateOnAnimation();
    }

    private static void copyRendered(Activity activity, WebView webView, double top, double height,
                                     int width, int targetHeight, Consumer<Bitmap> success, Consumer<Exception> failure) {
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
