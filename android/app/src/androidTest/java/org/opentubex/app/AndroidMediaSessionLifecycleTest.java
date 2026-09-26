package org.opentubex.app;

import static org.junit.Assert.*;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

import androidx.core.content.ContextCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.lang.ref.WeakReference;
import java.util.Arrays;

@RunWith(AndroidJUnit4.class)
public class AndroidMediaSessionLifecycleTest {
    @Test public void finalPositionUpdateAfterClearDoesNotCrashTheProcess() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().loadUrl("about:blank");
                // ended clears the notification; the final timeupdate can still
                // request foreground startup before Android delivers that clear.
                context.startService(new Intent(context, AndroidMediaSessionService.class)
                    .setAction(AndroidMediaSessionService.ACTION_UPDATE)
                    .putExtra(AndroidMediaSessionService.EXTRA_STATE, "{\"playbackState\":\"none\"}"));
                ContextCompat.startForegroundService(context, new Intent(context, AndroidMediaSessionService.class)
                    .setAction(AndroidMediaSessionService.ACTION_UPDATE)
                    .putExtra(AndroidMediaSessionService.EXTRA_STATE,
                        "{\"title\":\"Final position regression\",\"playbackState\":\"paused\"}"));
            });
            awaitForeground(context);
            SystemClock.sleep(10000);
            assertTrue("A newer playback request must survive the earlier clear", hasForegroundNotification(context));
        }
    }

    @Test public void activityTeardownAfterUpdateDoesNotCrashTheProcess() throws Exception {
        assertActivityTeardown(false);
    }

    @Test public void queuedUpdateCannotRestartPlaybackAfterActivityTeardown() throws Exception {
        assertActivityTeardown(true);
    }

    private void assertActivityTeardown(boolean beforeStartup) throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        java.util.concurrent.CountDownLatch destroyed = new java.util.concurrent.CountDownLatch(1);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                activity.getBridge().getWebView().loadUrl("about:blank");
                AndroidMediaSessionPlugin plugin = (AndroidMediaSessionPlugin)
                    activity.getBridge().getPlugin("AndroidMediaSession").getInstance();
                com.getcapacitor.JSObject data = new com.getcapacitor.JSObject();
                data.put("state", new com.getcapacitor.JSObject()
                    .put("title", "Activity teardown regression")
                    .put("playbackState", "paused"));
                Runnable destroy = () -> {
                    // Replay activity cleanup before Android delivers onStartCommand.
                    // Finishing alone leaves that ordering up to the system scheduler.
                    plugin.handleOnDestroy();
                    activity.finish();
                    destroyed.countDown();
                };
                plugin.update(new com.getcapacitor.PluginCall(null, "AndroidMediaSession", "test", "update", data) {
                    @Override public void resolve() {
                        if (!beforeStartup) destroy.run();
                    }
                });
                if (beforeStartup) destroy.run();
            });
            assertTrue(destroyed.await(3, java.util.concurrent.TimeUnit.SECONDS));
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.DESTROYED);
            SystemClock.sleep(1500);
            assertFalse("activity teardown removes media controls", hasForegroundNotification(context));
        }
    }

    private static boolean hasForegroundNotification(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        return Arrays.stream(manager.getActiveNotifications()).anyMatch(n ->
            n.getId() == 0x4d454449 && (n.getNotification().flags & Notification.FLAG_FOREGROUND_SERVICE) != 0);
    }

    private static void awaitForeground(Context context) {
        long deadline = SystemClock.uptimeMillis() + 3000;
        while (!hasForegroundNotification(context) && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(20);
        assertTrue("Every foreground service start must acknowledge even unchanged notification content", hasForegroundNotification(context));
    }
}
