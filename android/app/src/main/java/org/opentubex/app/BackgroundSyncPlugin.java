package org.opentubex.app;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.ref.WeakReference;
import java.util.Set;

@CapacitorPlugin(name = "BackgroundSync")
public class BackgroundSyncPlugin extends Plugin {
    private static final Set<String> NOTIFICATION_FEED_TYPES =
        Set.of("twitch", UploadNotifications.REPLY_FEED_TYPE, UploadNotifications.HEART_FEED_TYPE);
    private static WeakReference<BackgroundSyncPlugin> active = new WeakReference<>(null);

    @Override
    public void load() {
        // The renderer that syncs while the app is closed is not the app's.
        if (BackgroundSyncRenderer.isHidden(getBridge())) return;
        synchronized (BackgroundSyncPlugin.class) {
            active = new WeakReference<>(this);
        }
    }

    /** Whether the app's renderer is loaded, even if its activity is not. */
    static synchronized boolean hasRenderer() {
        return active.get() != null;
    }

    /** Asks the app's renderer to run its background tasks, returning the hold it releases afterwards. */
    static String requestSync(Context context) {
        BackgroundSyncPlugin plugin = active.get();
        if (plugin == null || !plugin.hasListeners("sync")) return null;
        String id = BackgroundSync.begin(context);
        JSObject data = new JSObject();
        data.put("id", id);
        plugin.notifyListeners("sync", data);
        return id;
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        String task = call.getString("task");
        if (task == null || task.isEmpty()) {
            call.reject("A task is required");
            return;
        }
        BackgroundSyncWorker.schedule(getContext(), task, call.getBoolean("enabled", false));
        call.resolve();
    }

    /**
     * Shows a notification that a background task found, such as a comment reply,
     * or leaves it to the visible app, like the notifications of new uploads.
     */
    @PluginMethod
    public void deliverNotification(PluginCall call) {
        String feedType = call.getString("feedType", "");
        String id = call.getString("id", "");
        String title = call.getString("title", "");
        if (!NOTIFICATION_FEED_TYPES.contains(feedType) || id.isEmpty() || title.isEmpty()) {
            call.reject("A notification needs its kind, ID and title");
            return;
        }
        String thumbnail = call.getString("thumbnail");
        UploadNotifications.deliver(getContext(), feedType, id, Boolean.TRUE.equals(call.getBoolean("live", false)), title,
            call.getString("body", ""), thumbnail != null && thumbnail.startsWith("https://") ? thumbnail : null,
            Boolean.TRUE.equals(call.getBoolean("history", false)), false);
        call.resolve();
    }

    @PluginMethod
    public void begin(PluginCall call) {
        JSObject result = new JSObject();
        // The job that loaded the hidden renderer already keeps it running.
        if (BackgroundSyncRenderer.isHidden(getBridge())) {
            call.resolve(result);
            return;
        }
        result.put("id", BackgroundSync.begin(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void end(PluginCall call) {
        String id = call.getString("id");
        if (id != null) BackgroundSync.end(getContext(), id);
        call.resolve();
    }

    /** The hidden renderer reports that its tasks ended. */
    @PluginMethod
    public void finishHiddenSync(PluginCall call) {
        BackgroundSyncRenderer.finish(getBridge());
        call.resolve();
    }

    // Capacitor calls this when a page starts loading; the new page holds nothing.
    @Override
    public void removeAllListeners() {
        super.removeAllListeners();
        BackgroundSync.clear(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        BackgroundSync.clear(getContext());
        synchronized (BackgroundSyncPlugin.class) {
            if (active.get() == this) active.clear();
        }
        super.handleOnDestroy();
    }
}
