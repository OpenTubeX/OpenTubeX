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
            "!!document.querySelector('.tutorialSkip button')", 15000);
        evaluate(view, "document.querySelector('.tutorialSkip button')?.click()", 15000);
        await(view, "!document.querySelector('.tutorialOverlay')", 15000);
    }

    private static void await(WebView view, String condition, long timeoutMs) throws Exception {
        long deadline = SystemClock.uptimeMillis() + timeoutMs;
        String value;
        do {
            // A starved software-GPU emulator can hold the UI thread, which
            // delivers the reply, for longer than one evaluation's budget.
            value = evaluate(view, condition, Math.max(15000, deadline - SystemClock.uptimeMillis()));
            if ("true".equals(value)) return;
            Thread.sleep(100);
        } while (SystemClock.uptimeMillis() < deadline);
        assertEquals(condition, "true", value);
    }

    private static String evaluate(WebView view, String script, long timeoutMs) throws Exception {
        CountDownLatch evaluated = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        assertTrue("JavaScript responds", evaluated.await(timeoutMs, TimeUnit.MILLISECONDS));
        return result.get();
    }
}
