package org.opentubex.app;

import android.os.ParcelFileDescriptor;
import android.util.Log;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import org.junit.runner.notification.Failure;
import org.junit.runner.notification.RunListener;

/** Logs which window and activity held the screen when a test failed. */
public final class FailureDiagnostics extends RunListener {
    @Override
    public void testFailure(Failure failure) {
        StringBuilder report = new StringBuilder(failure.getDescription().toString());
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
        Log.e("FailureDiagnostics", report.toString());
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
