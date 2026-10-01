package org.opentubex.app;

import android.app.Activity;
import android.graphics.Rect;
import android.graphics.RectF;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.webkit.WebView;

import java.util.ArrayList;
import java.util.List;

/** Scales the live video without resizing Chromium's viewport or video surface. */
final class PictureInPictureSurface {
    private final Activity activity;
    private final WebView webView;
    private View root;
    private RectF video;
    private int normalRootWidth;
    private int normalRootHeight;
    private int layoutWidth;
    private int layoutHeight;
    private View viewport;
    private int viewportWidth;
    private int viewportHeight;
    private float pivotX;
    private float pivotY;
    private float scaleX;
    private float scaleY;
    private float translationX;
    private float translationY;
    private Runnable returned;
    private final List<Clipping> clipping = new ArrayList<>();
    private final ViewTreeObserver.OnGlobalLayoutListener resized = this::fit;

    PictureInPictureSurface(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    void prepare(Rect source) {
        if (root != null || source == null || source.isEmpty() || webView.getWidth() == 0) {
            return;
        }
        root = activity.getWindow().getDecorView();
        normalRootWidth = root.getWidth();
        normalRootHeight = root.getHeight();
        int[] location = new int[2];
        webView.getLocationInWindow(location);
        video = new RectF(source);
        video.offset(-location[0], -location[1]);
        ViewGroup.LayoutParams params = webView.getLayoutParams();
        layoutWidth = params.width;
        layoutHeight = params.height;
        pivotX = webView.getPivotX();
        pivotY = webView.getPivotY();
        scaleX = webView.getScaleX();
        scaleY = webView.getScaleY();
        translationX = webView.getTranslationX();
        translationY = webView.getTranslationY();
        // Preserve both dimensions so Chromium keeps presenting the same live
        // video texture while Android animates and resizes the native window.
        params.width = webView.getWidth();
        params.height = webView.getHeight();
        webView.setLayoutParams(params);
        // SwipeRefreshLayout measures and lays out its child to its own size,
        // ignoring the child's fixed LayoutParams. Pin that viewport as well.
        viewport = (View) webView.getParent();
        ViewGroup.LayoutParams viewportParams = viewport.getLayoutParams();
        viewportWidth = viewportParams.width;
        viewportHeight = viewportParams.height;
        viewportParams.width = viewport.getWidth();
        viewportParams.height = viewport.getHeight();
        viewport.setLayoutParams(viewportParams);
        webView.setPivotX(0);
        webView.setPivotY(0);
        for (View parent = (View) webView.getParent(); parent instanceof ViewGroup group;
                parent = group.getParent() instanceof View next ? next : null) {
            clipping.add(new Clipping(group, group.getClipChildren(), group.getClipToPadding()));
            group.setClipChildren(false);
            group.setClipToPadding(false);
            if (group == root) break;
        }
        root.getViewTreeObserver().addOnGlobalLayoutListener(resized);
    }

    void onModeChanged(boolean active, Runnable notifyRenderer) {
        if (root == null) {
            notifyRenderer.run();
        } else if (active) {
            fit();
            notifyRenderer.run();
        } else {
            // Keep the live crop until the full native window has returned.
            // Then restore the page in the same frame as its normal viewport.
            returned = notifyRenderer;
            fit();
        }
    }

    private void fit() {
        if (root == null) return;
        if (returned != null) {
            float density = activity.getResources().getDisplayMetrics().density;
            // onResume can precede the destination configuration. Comparing
            // against that stale PiP width would remove the crop too early.
            // A full window regains at least one original dimension, including
            // when the phone rotated while the player was in PiP.
            if (root.getWidth() >= normalRootWidth - density * 2 ||
                root.getHeight() >= normalRootHeight - density * 2) {
                Runnable notify = returned;
                clear();
                notify.run();
                return;
            }
        }
        if (root.getWidth() == normalRootWidth && root.getHeight() == normalRootHeight) return;
        float scale = Math.min(root.getWidth() / video.width(), root.getHeight() / video.height());
        View parent = (View) webView.getParent();
        int[] origin = new int[2];
        parent.getLocationInWindow(origin);
        webView.setScaleX(scale);
        webView.setScaleY(scale);
        webView.setTranslationX((root.getWidth() - video.width() * scale) / 2 -
            origin[0] - webView.getLeft() - video.left * scale);
        webView.setTranslationY((root.getHeight() - video.height() * scale) / 2 -
            origin[1] - webView.getTop() - video.top * scale);
    }

    void clear() {
        returned = null;
        if (root == null) return;
        root.getViewTreeObserver().removeOnGlobalLayoutListener(resized);
        ViewGroup.LayoutParams params = webView.getLayoutParams();
        params.width = layoutWidth;
        params.height = layoutHeight;
        webView.setLayoutParams(params);
        ViewGroup.LayoutParams viewportParams = viewport.getLayoutParams();
        viewportParams.width = viewportWidth;
        viewportParams.height = viewportHeight;
        viewport.setLayoutParams(viewportParams);
        webView.setPivotX(pivotX);
        webView.setPivotY(pivotY);
        webView.setScaleX(scaleX);
        webView.setScaleY(scaleY);
        webView.setTranslationX(translationX);
        webView.setTranslationY(translationY);
        for (Clipping original : clipping) {
            original.view.setClipChildren(original.children);
            original.view.setClipToPadding(original.padding);
        }
        clipping.clear();
        root = null;
        video = null;
        viewport = null;
    }

    private record Clipping(ViewGroup view, boolean children, boolean padding) {}
}
