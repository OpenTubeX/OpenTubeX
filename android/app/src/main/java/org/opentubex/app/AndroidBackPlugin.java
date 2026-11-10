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

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            callback = new OnBackPressedCallback(false) {
                @Override
                public void handleOnBackStarted(BackEventCompat event) {
                    gestureActive = true;
                    emit("start", event.getProgress());
                }

                @Override
                public void handleOnBackProgressed(BackEventCompat event) {
                    emit("progress", event.getProgress());
                }

                @Override
                public void handleOnBackCancelled() {
                    emit("cancel", 0);
                    gestureActive = false;
                    setEnabled(enabled);
                }

                @Override
                public void handleOnBackPressed() {
                    emit("commit", 1);
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

    private void emit(String phase, float progress) {
        notifyListeners("backGesture", new JSObject().put("phase", phase).put("progress", progress));
    }

    @Override
    protected void handleOnDestroy() {
        if (callback != null) callback.remove();
    }
}
