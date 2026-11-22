package org.opentubex.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Stores the app lock on this device only, since the native side needs it before the renderer loads. */
@CapacitorPlugin(name = "AppLock")
public final class AppLockPlugin extends Plugin {
    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(new JSObject()
            .put("available", AppLock.isDeviceSecure(getContext()))
            .put("enabled", AppLock.isEnabled(getContext()))
            .put("timeoutSeconds", AppLock.getTimeoutSeconds(getContext())));
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        if (enabled && !AppLock.isDeviceSecure(getContext())) {
            call.reject("No screen lock is set", "UNAVAILABLE");
            return;
        }
        AppLock.setEnabled(getContext(), enabled);
        getActivity().runOnUiThread(() -> {
            AppLock.applyRecentsPreview(getActivity());
            call.resolve();
        });
    }

    @PluginMethod
    public void setTimeout(PluginCall call) {
        Integer seconds = call.getInt("seconds");
        if (seconds == null || seconds < 0) {
            call.reject("Invalid timeout");
            return;
        }
        AppLock.setTimeoutSeconds(getContext(), seconds);
        call.resolve();
    }
}
