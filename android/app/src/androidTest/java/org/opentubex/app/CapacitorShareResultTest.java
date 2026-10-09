package org.opentubex.app;

import static org.junit.Assert.*;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Intent;
import android.os.ParcelFileDescriptor;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.ActivityResultRegistry;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.capacitorjs.plugins.share.SharePlugin;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.io.InputStream;
import java.util.Map;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class CapacitorShareResultTest {
    private static class RecordingCall extends PluginCall {
        int completions;

        RecordingCall(String id) {
            super(null, "Share", id, "share", new JSObject().put("url", "https://youtu.be/abcdefghijk"));
        }

        @Override public void resolve(JSObject result) { completions++; }
        @Override public void reject(String message) { completions++; }
    }

    @Test public void aLateSelfShareResultCannotCompleteTheNextChooser() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().loadUrl("about:blank");
                SharePlugin plugin = (SharePlugin) activity.getBridge().getPlugin("Share").getInstance();
                RecordingCall first = new RecordingCall("share-result-first");
                RecordingCall second = new RecordingCall("share-result-second");
                try {
                    plugin.share(first);
                    ActivityResultRegistry registry = activity.getActivityResultRegistry();
                    int firstRequestCode = requestCode(registry, launcher(plugin));
                    String nonce = (String) field(SharePlugin.class, "expectedNonce").get(plugin);
                    BroadcastReceiver receiver = (BroadcastReceiver) field(SharePlugin.class, "broadcastReceiver").get(plugin);
                    receiver.onReceive(activity, new Intent(Intent.EXTRA_CHOSEN_COMPONENT)
                        .putExtra("_share_nonce", nonce)
                        .putExtra(Intent.EXTRA_CHOSEN_COMPONENT, new ComponentName(activity, MainActivity.class)));
                    assertEquals("Self-sharing completes on selection", 1, first.completions);

                    plugin.share(second);
                    int secondRequestCode = requestCode(registry, launcher(plugin));
                    assertEquals("The new chooser remains pending", 0, second.completions);
                    // Deliver the old launch's result after the next call has been saved.
                    registry.dispatchResult(firstRequestCode, Activity.RESULT_CANCELED, null);
                    registry.dispatchResult(firstRequestCode, Activity.RESULT_OK, null);
                    assertEquals("Late results cannot complete a different share", 0, second.completions);
                    assertEquals("The first call is completed only once", 1, first.completions);
                    registry.dispatchResult(secondRequestCode, Activity.RESULT_CANCELED, null);
                    assertEquals("The new chooser still accepts its own result", 1, second.completions);
                } catch (ReflectiveOperationException error) {
                    throw new AssertionError(error);
                } finally {
                    activity.getBridge().releaseCall(first);
                    activity.getBridge().releaseCall(second);
                }
            });
        } finally {
            // The chooser belongs to Android, so ordinary instrumentation key
            // injection cannot dismiss it on older releases.
            try (InputStream output = new ParcelFileDescriptor.AutoCloseInputStream(
                InstrumentationRegistry.getInstrumentation().getUiAutomation()
                    .executeShellCommand("input keyevent BACK; input keyevent BACK"))) {
                while (output.read() != -1) { }
            }
        }
    }

    private static Field field(Class<?> type, String name) throws ReflectiveOperationException {
        Field field = type.getDeclaredField(name);
        field.setAccessible(true);
        return field;
    }

    private static ActivityResultLauncher<?> launcher(SharePlugin plugin) throws ReflectiveOperationException {
        try {
            return (ActivityResultLauncher<?>) field(SharePlugin.class, "shareLauncher").get(plugin);
        } catch (NoSuchFieldException originalCallback) {
            // Exercise the original Capacitor callback too, to demonstrate the regression.
            return (ActivityResultLauncher<?>) ((Map<?, ?>) field(Plugin.class, "activityLaunchers").get(plugin)).get("activityResult");
        }
    }

    private static int requestCode(ActivityResultRegistry registry, ActivityResultLauncher<?> launcher) throws ReflectiveOperationException {
        Map<?, ?> codes = (Map<?, ?>) field(ActivityResultRegistry.class, "keyToRc").get(registry);
        for (Field field : launcher.getClass().getDeclaredFields()) {
            field.setAccessible(true);
            Object value = field.get(launcher);
            if (value instanceof String && codes.containsKey(value)) return (Integer) codes.get(value);
        }
        throw new AssertionError("The launcher's registry request code is available");
    }
}
