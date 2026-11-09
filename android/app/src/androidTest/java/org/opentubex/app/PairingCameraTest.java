package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.ParcelFileDescriptor;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class PairingCameraTest {
    @Test
    public void pairingScannerCanOpenTheCameraInTheWebView() throws Exception {
        String packageName = InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName();
        try (ParcelFileDescriptor.AutoCloseInputStream output = new ParcelFileDescriptor.AutoCloseInputStream(
                InstrumentationRegistry.getInstrumentation().getUiAutomation()
                    .executeShellCommand("pm grant " + packageName + " " + Manifest.permission.CAMERA))) {
            while (output.read() != -1) {}
        }
        assertEquals("Android must be able to grant camera access for pairing", PackageManager.PERMISSION_GRANTED,
            InstrumentationRegistry.getInstrumentation().getTargetContext().checkSelfPermission(Manifest.permission.CAMERA));
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> view = new AtomicReference<>();
            scenario.onActivity(activity -> view.set(activity.getBridge().getWebView()));
            awaitValue(view.get(), "location.protocol === 'https:' && document.readyState === 'complete'", "true");
            // The pairing scanner asks for the rear camera like this.
            evaluate(view.get(),
                "window.pairingCameraResult = 'pending';" +
                "navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function(stream) {" +
                "  window.pairingCameraResult = stream.getVideoTracks().length > 0 ? 'opened' : 'no video';" +
                "  stream.getTracks().forEach(function(track) { track.stop(); });" +
                "}, function(error) { window.pairingCameraResult = error.name; });"
            );
            awaitValue(view.get(), "window.pairingCameraResult", "\"opened\"");
        }
    }

    private static void awaitValue(WebView view, String script, String expected) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        String actual;
        do {
            actual = evaluate(view, script);
            if (expected.equals(actual)) return;
            Thread.sleep(100);
        } while (System.nanoTime() < deadline);
        assertEquals(expected, actual);
    }

    private static String evaluate(WebView view, String script) throws Exception {
        CountDownLatch evaluated = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            view.evaluateJavascript(script, value -> {
                result.set(value);
                evaluated.countDown();
            })
        );
        assertTrue("WebView responds", evaluated.await(5, TimeUnit.SECONDS));
        return result.get();
    }
}
