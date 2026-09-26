package org.opentubex.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.webkit.WebView;

import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.getcapacitor.JSObject;

/** Native gesture handling; the renderer decides which DOM targets can refresh. */
public class PullToRefreshLayout extends SwipeRefreshLayout {
    private WebView webView;
    private boolean configured;
    private boolean starting;
    private boolean allowed;
    private long gesture;
    private float startX;
    private float startY;
    private JSObject refreshContext;

    public PullToRefreshLayout(Context context, AttributeSet attrs) {
        super(context, attrs);
        setEnabled(false);
        setOnChildScrollUpCallback((parent, child) ->
            webView == null || webView.canScrollVertically(-1) || (!starting && !allowed));
    }

    public void configure(WebView view, boolean enabled) {
        webView = view;
        configured = enabled;
        gesture++;
        allowed = false;
        setEnabled(enabled);
        if (!enabled) setRefreshing(false);
    }

    public JSObject getRefreshContext() {
        return refreshContext;
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        int action = event.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN && !isRefreshing()) {
            long currentGesture = ++gesture;
            allowed = false;
            refreshContext = null;
            startX = event.getX();
            startY = event.getY();
            setEnabled(configured);
            if (configured && webView != null && !webView.canScrollVertically(-1)) {
                // Normalized WebView coordinates also work with page zoom and density changes.
                double x = (event.getX() - webView.getLeft()) / Math.max(1, webView.getWidth());
                double y = (event.getY() - webView.getTop()) / Math.max(1, webView.getHeight());
                webView.evaluateJavascript(
                    "window.__opentubexPullToRefresh?.(" + x + "," + y + ") ?? null",
                    result -> {
                        if (currentGesture != gesture || !configured) return;
                        try {
                            JSObject context = new JSObject(result);
                            if (context.getString("tabId") == null) return;
                            refreshContext = context;
                            float density = getResources().getDisplayMetrics().density;
                            int offset = (int) (context.optDouble("offset", 0) * webView.getHeight());
                            setProgressViewOffset(false, offset, offset + (int) (64 * density));
                            applyColors(context);
                            allowed = true;
                        } catch (Exception ignored) {
                            // Missing renderer, rejected target, or navigation: leave scrolling alone.
                        }
                    }
                );
            }
        } else if (action == MotionEvent.ACTION_POINTER_DOWN ||
            (action == MotionEvent.ACTION_MOVE &&
                Math.abs(event.getX() - startX) > ViewConfiguration.get(getContext()).getScaledTouchSlop() &&
                Math.abs(event.getX() - startX) > Math.abs(event.getY() - startY))) {
            // A horizontal gesture or a second finger cancels the entire pull.
            gesture++;
            allowed = false;
            if (!isRefreshing()) setEnabled(false);
        }

        // Seed Android's gesture tracking on DOWN, but do not intercept moves until
        // the asynchronous DOM hit test has approved this particular gesture.
        starting = action == MotionEvent.ACTION_DOWN;
        boolean handled = super.dispatchTouchEvent(event);
        starting = false;
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
            gesture++;
            // AndroidX does not finish or dismiss a drag on ACTION_CANCEL.
            // Reset it now; the next DOWN restores the configured enabled state.
            if (action == MotionEvent.ACTION_CANCEL && !isRefreshing()) setEnabled(false);
        }
        return handled;
    }

    private void applyColors(JSObject context) {
        try {
            setColorSchemeColors(parseColor(context.getString("color", "#000000")));
            setProgressBackgroundColorSchemeColor(parseColor(context.getString("backgroundColor", "#ffffff")));
        } catch (IllegalArgumentException ignored) {
            // A custom theme must not disable gesture recognition.
        }
    }

    private static int parseColor(String color) {
        if (color.matches("#[0-9a-fA-F]{3,4}")) {
            StringBuilder expanded = new StringBuilder("#");
            for (int i = 1; i < color.length(); i++) expanded.append(color.charAt(i)).append(color.charAt(i));
            color = expanded.toString();
        }
        if (color.isEmpty()) throw new IllegalArgumentException("Empty theme color");
        return com.getcapacitor.util.WebColor.parseColor(color);
    }
}
