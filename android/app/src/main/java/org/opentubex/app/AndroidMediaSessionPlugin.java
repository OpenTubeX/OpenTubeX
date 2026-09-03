package org.opentubex.app;

import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.ref.WeakReference;

@CapacitorPlugin(name = "AndroidMediaSession")
public class AndroidMediaSessionPlugin extends Plugin {
    private static WeakReference<AndroidMediaSessionPlugin> activePlugin = new WeakReference<>(null);

    @Override
    public void load() {
        activePlugin = new WeakReference<>(this);
    }

    @Override
    protected void handleOnDestroy() {
        if (activePlugin.get() == this) {
            activePlugin.clear();
            getContext().stopService(new Intent(getContext(), AndroidMediaSessionService.class));
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void update(PluginCall call) {
        JSObject state = call.getObject("state");
        if (state == null) {
            call.reject("Media state is required");
            return;
        }

        Intent intent = new Intent(getContext(), AndroidMediaSessionService.class)
            .setAction(AndroidMediaSessionService.ACTION_UPDATE)
            .putExtra(AndroidMediaSessionService.EXTRA_STATE, state.toString());
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        getContext().stopService(new Intent(getContext(), AndroidMediaSessionService.class));
        call.resolve();
    }

    static void emitAction(String action) {
        emitAction(action, null, null);
    }

    static void emitAction(String action, Double seekTime, Double seekOffset) {
        if (!AndroidMediaActions.isSupported(action)) {
            return;
        }

        AndroidMediaSessionPlugin plugin = activePlugin.get();
        if (plugin == null) {
            return;
        }

        JSObject event = new JSObject();
        event.put("action", action);
        if (seekTime != null) event.put("seekTime", seekTime);
        if (seekOffset != null) event.put("seekOffset", seekOffset);
        plugin.notifyListeners("action", event);
    }
}
