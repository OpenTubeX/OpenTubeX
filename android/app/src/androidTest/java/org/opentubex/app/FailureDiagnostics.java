package org.opentubex.app;

import android.os.ParcelFileDescriptor;
import android.os.Process;
import android.util.Log;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
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
 * every thread's stack and ends its process so the shard can continue.
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

    private static void reportStall(Description description) {
        Log.e(TAG, description + " is still running after " + STALL_MINUTES + " minutes" + windowState());
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
