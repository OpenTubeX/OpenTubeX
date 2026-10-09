package org.opentubex.app;

import static org.junit.Assert.*;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Intent;
import android.os.ParcelFileDescriptor;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.ActivityResultRegistry;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleCallback;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import com.capacitorjs.plugins.share.SharePlugin;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginResult;
import java.lang.reflect.Field;
import java.io.InputStream;
import java.util.Map;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class CapacitorShareResultTest {

    @Test public void pendingShareSurvivesRepeatedActivityRecreation() throws Exception {
        assertRestoredShare(false);
    }

    @Test public void selfShareSurvivesRepeatedActivityRecreation() throws Exception {
        assertRestoredShare(true);
    }

    private void assertRestoredShare(boolean selfShare) throws Exception {
        int[] code = new int[1];
        Bundle[] saved = new Bundle[1];
        ActivityLifecycleCallback stopRenderer = (activity, stage) -> {
            if (activity instanceof MainActivity main && stage == Stage.CREATED) {
                main.getBridge().getWebView().loadUrl("about:blank");
            }
        };
        ActivityLifecycleMonitorRegistry.getInstance().addLifecycleCallback(stopRenderer);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().loadUrl("about:blank");
                SharePlugin plugin = (SharePlugin) activity.getBridge().getPlugin("Share").getInstance();
                plugin.share(new RecordingCall("share-result-recreate"));
                try {
                    ActivityResultRegistry registry = (ActivityResultRegistry) field(SharePlugin.class, "shareResults").get(plugin);
                    code[0] = requestCode(registry, launcher(plugin));
                    Bundle state = new Bundle();
                    activity.onSaveInstanceState(state);
                    assertEquals("Capacitor saves the pending share call", "Share", state.getString("capacitorLastActivityPluginId"));
                    saved[0] = state;
                } catch (ReflectiveOperationException error) {
                    throw new AssertionError(error);
                }
            });
            // ActivityScenario cannot foreground an Activity behind a system
            // chooser. Restore its pending snapshot in a new Activity, as after
            // process death, then exercise real recreation while still pending.
            dismissChoosers(1);
            scenario.recreate();
            scenario.onActivity(activity -> activity.getBridge().restoreInstanceState(saved[0]));
            for (int i = 0; i < 2; i++) {
                scenario.recreate();
            }
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().loadUrl("about:blank");
                SharePlugin plugin = (SharePlugin) activity.getBridge().getPlugin("Share").getInstance();
                PluginResult[] restored = new PluginResult[1];
                activity.getBridge().getApp().setAppRestoredListener(result -> restored[0] = result);
                try {
                    ActivityResultRegistry registry = (ActivityResultRegistry) field(SharePlugin.class, "shareResults").get(plugin);
                    assertEquals("The recreated chooser keeps its request code", code[0], requestCode(registry, launcher(plugin)));
                    Bundle pendingState = new Bundle();
                    activity.onSaveInstanceState(pendingState);
                    assertEquals("The original share options survive repeated recreation", "https://youtu.be/abcdefghijk", new JSObject(pendingState.getString("capacitorLastPluginCallOptions")).getString("url"));
                    if (selfShare) {
                        String nonce = (String) field(SharePlugin.class, "expectedNonce").get(plugin);
                        BroadcastReceiver receiver = (BroadcastReceiver) field(SharePlugin.class, "broadcastReceiver").get(plugin);
                        receiver.onReceive(activity, new Intent(Intent.EXTRA_CHOSEN_COMPONENT)
                            .putExtra("_share_nonce", nonce)
                            .putExtra(Intent.EXTRA_CHOSEN_COMPONENT, new ComponentName(activity, MainActivity.class)));
                    } else {
                        activity.onActivityResult(code[0], Activity.RESULT_OK, null);
                    }
                    assertNotNull("Capacitor delivers the restored share result", restored[0]);
                    assertEquals("Share", restored[0].getWrappedResult().getString("pluginId"));
                    assertEquals("share", restored[0].getWrappedResult().getString("methodName"));
                    assertEquals(true, restored[0].getWrappedResult().getBoolean("success"));
                    assertEquals(selfShare ? activity.getPackageName() : "", restored[0].getWrappedResult().getJSObject("data").getString("activityType"));
                    assertNoShareRegistryEntries(registry);
                    Bundle state = new Bundle();
                    activity.onSaveInstanceState(state);
                    assertNull("Completed shares are no longer persisted", state.getString("capacitorLastActivityPluginId"));
                } catch (Exception error) {
                    throw new AssertionError(error);
                }
            });
        } finally {
            ActivityLifecycleMonitorRegistry.getInstance().removeLifecycleCallback(stopRenderer);
            dismissChoosers(2);
        }
    }

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
                    ActivityResultRegistry registry = (ActivityResultRegistry) field(SharePlugin.class, "shareResults").get(plugin);
                    int firstRequestCode = requestCode(registry, launcher(plugin));
                    String nonce = (String) field(SharePlugin.class, "expectedNonce").get(plugin);
                    BroadcastReceiver receiver = (BroadcastReceiver) field(SharePlugin.class, "broadcastReceiver").get(plugin);
                    receiver.onReceive(activity, new Intent(Intent.EXTRA_CHOSEN_COMPONENT)
                        .putExtra("_share_nonce", nonce)
                        .putExtra(Intent.EXTRA_CHOSEN_COMPONENT, new ComponentName(activity, MainActivity.class)));
                    assertEquals("Self-sharing completes on selection", 1, first.completions);
                    assertNoShareRegistryEntries(registry);

                    plugin.share(second);
                    int secondRequestCode = requestCode(registry, launcher(plugin));
                    assertEquals("The new chooser remains pending", 0, second.completions);
                    // Deliver the old launch's result after the next call has been saved.
                    activity.onActivityResult(firstRequestCode, Activity.RESULT_CANCELED, null);
                    activity.onActivityResult(firstRequestCode, Activity.RESULT_OK, null);
                    assertEquals("Late results cannot complete a different share", 0, second.completions);
                    assertEquals("The first call is completed only once", 1, first.completions);
                    activity.onActivityResult(secondRequestCode, Activity.RESULT_CANCELED, null);
                    assertEquals("The new chooser still accepts its own result", 1, second.completions);
                    assertNoShareRegistryEntries(registry);
                } catch (ReflectiveOperationException error) {
                    throw new AssertionError(error);
                } finally {
                    activity.getBridge().releaseCall(first);
                    activity.getBridge().releaseCall(second);
                }
            });
        } finally {
            dismissChoosers(2);
        }
    }

    @Test public void repeatedResultsAndActivityDestructionReleaseShareRegistryEntries() throws Exception {
        ActivityResultRegistry[] registry = new ActivityResultRegistry[1];
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().loadUrl("about:blank");
                SharePlugin plugin = (SharePlugin) activity.getBridge().getPlugin("Share").getInstance();
                try {
                    registry[0] = (ActivityResultRegistry) field(SharePlugin.class, "shareResults").get(plugin);
                    for (int i = 0; i < 3; i++) {
                        RecordingCall call = new RecordingCall("share-result-repeat-" + i);
                        plugin.share(call);
                        int code = requestCode(registry[0], launcher(plugin));
                        activity.onActivityResult(code, i % 2 == 0 ? Activity.RESULT_CANCELED : Activity.RESULT_OK, null);
                        activity.onActivityResult(code, Activity.RESULT_OK, null);
                        assertEquals("Each chooser completes only once", 1, call.completions);
                        assertNoShareRegistryEntries(registry[0]);
                        assertNoShareRegistryEntries(activity.getActivityResultRegistry());
                    }
                    RecordingCall next = new RecordingCall("share-result-reentrant-next");
                    RecordingCall reentrant = new RecordingCall("share-result-reentrant") {
                        @Override public void resolve(JSObject result) {
                            super.resolve(result);
                            plugin.share(next);
                        }
                    };
                    plugin.share(reentrant);
                    int previousCode = requestCode(registry[0], launcher(plugin));
                    activity.onActivityResult(previousCode, Activity.RESULT_OK, null);
                    assertEquals("The previous result finishes once", 1, reentrant.completions);
                    int nextCode = requestCode(registry[0], launcher(plugin));
                    activity.onActivityResult(previousCode, Activity.RESULT_OK, null);
                    assertEquals("Cleanup preserves a chooser opened by the callback", 0, next.completions);
                    activity.onActivityResult(nextCode, Activity.RESULT_OK, null);
                    assertEquals("The reentrant chooser still receives its result", 1, next.completions);
                    assertNoShareRegistryEntries(registry[0]);
                    plugin.share(new RecordingCall("share-result-destroy"));
                    assertNotNull("A chooser remains active before destruction", launcher(plugin));
                } catch (ReflectiveOperationException error) {
                    throw new AssertionError(error);
                }
            });
        } finally {
            dismissChoosers(2);
        }
        assertNoShareRegistryEntries(registry[0]);
    }

    private static void dismissChoosers(int backPresses) throws Exception {
        if (backPresses == 1) {
            long deadline = SystemClock.uptimeMillis() + 10000;
            boolean chooserVisible = false;
            while (!chooserVisible && SystemClock.uptimeMillis() < deadline) {
                AccessibilityNodeInfo root = InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
                String owner = root == null ? "" : String.valueOf(root.getPackageName());
                chooserVisible = owner.equals("android") || owner.equals("com.android.intentresolver");
                if (!chooserVisible) SystemClock.sleep(50);
            }
            assertTrue("The system chooser is ready before cancelling it", chooserVisible);
            InstrumentationRegistry.getInstrumentation().getUiAutomation().waitForIdle(100, 5000);
        }
        // The chooser belongs to Android, so ordinary instrumentation key
        // injection cannot dismiss it on older releases.
        try (InputStream output = new ParcelFileDescriptor.AutoCloseInputStream(
            InstrumentationRegistry.getInstrumentation().getUiAutomation()
                .executeShellCommand(backPresses == 1 ? "input keyevent BACK" : "input keyevent BACK; input keyevent BACK"))) {
            while (output.read() != -1) { }
        }
    }

    private static void assertNoShareRegistryEntries(ActivityResultRegistry registry) throws ReflectiveOperationException {
        Map<?, ?> codes = (Map<?, ?>) field(ActivityResultRegistry.class, "keyToRc").get(registry);
        for (Object key : codes.keySet()) {
            assertFalse("Completed shares release their request-code mappings", key.toString().startsWith("capacitor-share-"));
        }
        Bundle state = new Bundle();
        registry.onSaveInstanceState(state);
        for (String key : state.keySet()) {
            assertFalse("Completed shares leave no saved-state entries", String.valueOf(state.get(key)).contains("capacitor-share-"));
        }
    }

    private static Field field(Class<?> type, String name) throws ReflectiveOperationException {
        Field field = type.getDeclaredField(name);
        field.setAccessible(true);
        return field;
    }

    private static ActivityResultLauncher<?> launcher(SharePlugin plugin) throws ReflectiveOperationException {
        return (ActivityResultLauncher<?>) field(SharePlugin.class, "shareLauncher").get(plugin);
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
