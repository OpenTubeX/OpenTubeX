package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.os.SystemClock;
import android.webkit.WebView;

import androidx.test.platform.app.InstrumentationRegistry;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

final class TutorialTestHelper {
    private TutorialTestHelper() {}

    /**
     * Dismisses the first-run tutorial if startup shows it. Startup marks a
     * pending tutorial 'new' before it renders .app and shows the tutorial
     * afterwards. Existing installs skip it without setting the key.
     */
    static void dismissIfPending(WebView view) throws Exception {
        await(view, "!!document.querySelector('.app')", 60000);
        await(view, "localStorage.getItem('opentubex.tutorial.audience') !== 'new' || " +
            "!!document.querySelector('.tutorialActions button')", 15000);
        evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
        await(view, "!document.querySelector('.tutorialOverlay')", 15000);
    }

    private static void await(WebView view, String condition, long timeoutMs) throws Exception {
        long deadline = SystemClock.uptimeMillis() + timeoutMs;
        String value;
        do {
            value = evaluate(view, condition);
            if ("true".equals(value)) return;
            Thread.sleep(100);
        } while (SystemClock.uptimeMillis() < deadline);
        assertEquals(condition, "true", value);
    }

    private static String evaluate(WebView view, String script) throws Exception {
        CountDownLatch evaluated = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        // A busy software-GPU emulator can hold the UI thread for several seconds.
        assertTrue("JavaScript responds", evaluated.await(15, TimeUnit.SECONDS));
        return result.get();
    }
}
