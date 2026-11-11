package org.opentubex.app;

import android.os.ParcelFileDescriptor;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import org.junit.runner.Description;
import org.junit.runner.notification.Failure;
import org.junit.runner.notification.RunListener;

/**
 * Logs which window and activity held the screen when a test failed. A test
 * that outlives the runner's per-test timeout, for example in teardown, logs
 * every thread's stack and ends its process so the shard can continue. Before
 * each test, it closes another app's "isn't responding" dialog, which would
 * otherwise keep focus for every later test.
 */
public final class FailureDiagnostics extends RunListener {
    private static final String TAG = "FailureDiagnostics";
    private static final long STALL_MINUTES = 12;

    private final ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "TestWatchdog");
        thread.setDaemon(true);
        return thread;
    });
    private ScheduledFuture<?> stall;

    @Override
    public void testStarted(Description description) {
        closeOtherAppsNotRespondingDialog(description);
        stall = watchdog.schedule(() -> reportStall(description), STALL_MINUTES, TimeUnit.MINUTES);
    }

    @Override
    public void testFinished(Description description) {
        if (stall != null) stall.cancel(false);
    }

    @Override
    public void testFailure(Failure failure) {
        Log.e(TAG, failure.getDescription() + windowState());
    }

    /** On a starved emulator the launcher can stop responding; this app's own dialogs stay open. */
    private static void closeOtherAppsNotRespondingDialog(Description description) {
        try {
            android.app.UiAutomation automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
            // A freshly connected UiAutomation sees no windows until accessibility reports them.
            AccessibilityNodeInfo root = automation.getRootInActiveWindow();
            for (long deadline = SystemClock.uptimeMillis() + 3000; root == null && SystemClock.uptimeMillis() < deadline;) {
                SystemClock.sleep(100);
                root = automation.getRootInActiveWindow();
            }
            if (root == null || !"android".contentEquals(String.valueOf(root.getPackageName()))) return;
            List<AccessibilityNodeInfo> close = root.findAccessibilityNodeInfosByViewId("android:id/aerr_close");
            if (close.isEmpty()) return;
            List<AccessibilityNodeInfo> titles = root.findAccessibilityNodeInfosByViewId("android:id/alertTitle");
            String title = titles.isEmpty() ? "" : String.valueOf(titles.get(0).getText());
            android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
            if (title.contains(context.getPackageManager().getApplicationLabel(context.getApplicationInfo()))) return;
            Log.w(TAG, "Closing \"" + title + "\" before " + description);
            close.get(0).performAction(AccessibilityNodeInfo.ACTION_CLICK);
            long deadline = SystemClock.uptimeMillis() + 5000;
            while (SystemClock.uptimeMillis() < deadline) {
                AccessibilityNodeInfo active = automation.getRootInActiveWindow();
                if (active == null || active.findAccessibilityNodeInfosByViewId("android:id/aerr_close").isEmpty()) return;
                SystemClock.sleep(100);
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Unable to check for another app's dialog", error);
        }
    }

    private static void reportStall(Description description) {
        // No shell commands here: a wedged device could block them and keep the shard hanging.
        Log.e(TAG, description + " is still running after " + STALL_MINUTES + " minutes");
        for (Map.Entry<Thread, StackTraceElement[]> entry : Thread.getAllStackTraces().entrySet()) {
            StringBuilder stack = new StringBuilder("Thread ").append(entry.getKey().getName())
                .append(" (").append(entry.getKey().getState()).append(')');
            for (StackTraceElement frame : entry.getValue()) stack.append("\n    at ").append(frame);
            Log.e(TAG, stack.toString());
        }
        Process.killProcess(Process.myPid());
    }

    private static String windowState() {
        StringBuilder report = new StringBuilder();
        try {
            for (String line : shell("dumpsys window").split("\n")) {
                if (line.contains("mCurrentFocus") || line.contains("mFocusedApp")) report.append('\n').append(line.trim());
            }
            for (String line : shell("dumpsys activity activities").split("\n")) {
                if (line.contains("ResumedActivity")) report.append('\n').append(line.trim());
            }
        } catch (Exception error) {
            report.append("\nUnable to read window state: ").append(error);
        }
        return report.toString();
    }

    private static String shell(String command) throws Exception {
        ParcelFileDescriptor descriptor = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
        try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int count; (count = input.read(buffer)) != -1;) output.write(buffer, 0, count);
            return output.toString("UTF-8");
        }
    }
}
