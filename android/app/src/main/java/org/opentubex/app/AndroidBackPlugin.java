package org.opentubex.app;

import androidx.activity.BackEventCompat;
import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** AndroidX supplies gesture progress on API 34+ and ordinary Back on older devices. */
@CapacitorPlugin(name = "AndroidBack")
public class AndroidBackPlugin extends Plugin {
    private OnBackPressedCallback callback;
    private boolean gestureActive;
    private boolean enabled;
    private float startX;

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            callback = new OnBackPressedCallback(false) {
                @Override
                public void handleOnBackStarted(BackEventCompat event) {
                    gestureActive = true;
                    startX = event.getTouchX();
                    JSObject start = backEvent("start", event.getProgress()).put("edge", getEdge(event)).put("drag", 0);
                    notifyListeners("backGesture", start);
                }

                @Override
                public void handleOnBackProgressed(BackEventCompat event) {
                    notifyListeners("backGesture", backEvent("progress", event.getProgress()).put("drag", getDrag(event)));
                }

                @Override
                public void handleOnBackCancelled() {
                    notifyListeners("backGesture", backEvent("cancel", 0));
                    gestureActive = false;
                    setEnabled(enabled);
                }

                @Override
                public void handleOnBackPressed() {
                    notifyListeners("backGesture", backEvent("commit", 1));
                    gestureActive = false;
                    setEnabled(enabled);
                }
            };
            getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), callback);
        });
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean requested = call.getBoolean("enabled", false);
        getActivity().runOnUiThread(() -> {
            enabled = requested;
            // A preview changes the DOM. Keep ownership until this gesture ends.
            if (!gestureActive) callback.setEnabled(enabled);
            call.resolve();
        });
    }

    private static JSObject backEvent(String phase, float progress) {
        return new JSObject().put("phase", phase).put("progress", progress);
    }

    /**
     * How far the finger moved since the gesture started, as a share of the
     * page width. Progress eases out, so a page that follows the finger uses this.
     */
    private float getDrag(BackEventCompat event) {
        float width = getBridge().getWebView().getWidth();
        if (width <= 0 || event.getSwipeEdge() != BackEventCompat.EDGE_LEFT && event.getSwipeEdge() != BackEventCompat.EDGE_RIGHT) {
            return event.getProgress();
        }
        float distance = event.getSwipeEdge() == BackEventCompat.EDGE_LEFT ? event.getTouchX() - startX : startX - event.getTouchX();
        return Math.max(0f, Math.min(1f, distance / width));
    }

    /** Previews move with the swipe, away from the edge it started at. */
    private static String getEdge(BackEventCompat event) {
        switch (event.getSwipeEdge()) {
            case BackEventCompat.EDGE_LEFT:
                return "left";
            case BackEventCompat.EDGE_RIGHT:
                return "right";
            default:
                return "none";
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (callback != null) callback.remove();
    }
}
