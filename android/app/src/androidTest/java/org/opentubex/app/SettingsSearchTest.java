package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class SettingsSearchTest {
    @Test
    public void filtersBeforeTheKeyboardCommitsItsComposingText() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            awaitCondition(view, "!!document.querySelector('.app')");
            awaitCondition(view, "localStorage.getItem('opentubex.tutorial.audience') === 'completed' || " +
                "!!document.querySelector('.tutorialActions button')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            awaitCondition(view, "!document.querySelector('.tutorialOverlay')");
            evaluate(view, """
                (async () => {
                    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                    window.__settingsSearchSaved = {
                        CurrentLocale: store.getters.getCurrentLocale,
                        CapacitorLayoutMode: store.getters.getCapacitorLayoutMode
                    };
                    store.commit('setCurrentLocale', 'en-US');
                    await store.dispatch('triggerCurrentLocaleSideEffects', 'en-US');
                    store.commit('setCapacitorLayoutMode', 'phone');
                    store.dispatch('showSettingsWindow');
                })()
                """);
            try {
                awaitCondition(view, "document.documentElement.lang === 'en-US'");
                awaitCondition(view, "!!document.querySelector('.settingsSearch input')");
                evaluate(view, """
                    (() => {
                        const input = document.querySelector('.settingsSearch input');
                        input.addEventListener('input', event => window.__settingsSearchComposing = event.isComposing);
                    })()
                    """);
                tapSearch(scenario, view);
                awaitCondition(view, "document.activeElement === document.querySelector('.settingsSearch input')");
                // This test acts as the IME. Hide the system keyboard so it
                // cannot commit or replace the test's composing region.
                scenario.onActivity(activity -> activity.getSystemService(InputMethodManager.class)
                    .hideSoftInputFromWindow(view.getWindowToken(), 0));
                AtomicBoolean keyboardVisible = new AtomicBoolean(true);
                long keyboardDeadline = SystemClock.uptimeMillis() + 5000;
                while (keyboardVisible.get() && SystemClock.uptimeMillis() < keyboardDeadline) {
                    scenario.onActivity(activity -> {
                        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(view);
                        keyboardVisible.set(insets == null || insets.isVisible(WindowInsetsCompat.Type.ime()));
                    });
                    if (keyboardVisible.get()) Thread.sleep(100);
                }
                assertTrue("System keyboard is hidden before simulating composing input", !keyboardVisible.get());
                AtomicReference<InputConnection> connection = new AtomicReference<>();
                long deadline = SystemClock.uptimeMillis() + 5000;
                while (connection.get() == null && SystemClock.uptimeMillis() < deadline) {
                    scenario.onActivity(activity -> connection.set(view.onCreateInputConnection(new EditorInfo())));
                    if (connection.get() == null) Thread.sleep(100);
                }
                assertNotNull("Search exposes a native keyboard input connection", connection.get());

                for (String text : new String[] {"roundn", "roundness", "roundnes"}) {
                    scenario.onActivity(activity -> assertTrue(connection.get().setComposingText(text, 1)));
                    awaitCondition(view, "document.querySelector('.settingsSearch input').value === '" + text + "'");
                    awaitCondition(view, "[...document.querySelectorAll('.settingsSearchResultMatch')].some(" +
                        "match => match.textContent.trim() === 'UI Roundness')");
                    awaitCondition(view, "document.querySelectorAll('.settingsSearchResultMatch').length === 1");
                    assertEquals("The word is still composing", "true", evaluate(view, "window.__settingsSearchComposing"));
                    assertEquals("Filtering keeps keyboard focus", "true", evaluate(view,
                        "document.activeElement === document.querySelector('.settingsSearch input')"));
                }
                scenario.onActivity(activity -> assertTrue(connection.get().setComposingText("zzzzzz", 1)));
                awaitCondition(view, "!!document.querySelector('.settingsNoResults')");
                scenario.onActivity(activity -> assertTrue(connection.get().setComposingText("", 1)));
                awaitCondition(view, "!document.querySelector('.settingsSearchResults') && " +
                    "document.querySelector('.settingsMenu').getBoundingClientRect().height > 0");
                scenario.onActivity(activity -> {
                    assertTrue(connection.get().finishComposingText());
                    assertTrue(connection.get().commitText("ui scale", 1));
                });
                awaitCondition(view, "document.querySelector('.settingsSearchResultMatch')?.textContent.trim() === 'UI Scale'");
            } finally {
                evaluate(view, """
                    (async () => {
                        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                        store.dispatch('hideSettingsWindow');
                        for (const [key, value] of Object.entries(window.__settingsSearchSaved)) {
                            store.commit('set' + key, value);
                        }
                        await store.dispatch('triggerCurrentLocaleSideEffects', window.__settingsSearchSaved.CurrentLocale);
                        delete window.__settingsSearchSaved;
                        delete window.__settingsSearchComposing;
                        window.__settingsSearchRestored = true;
                    })()
                    """);
                awaitCondition(view, "window.__settingsSearchRestored === true");
                evaluate(view, "delete window.__settingsSearchRestored");
            }
        }
    }

    private static void tapSearch(ActivityScenario<MainActivity> scenario, WebView view) throws Exception {
        JSONArray bounds = new JSONArray(evaluate(view, """
            (() => {
                const bounds = document.querySelector('.settingsSearch input').getBoundingClientRect();
                return [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, innerWidth];
            })()
            """));
        float[] point = new float[2];
        scenario.onActivity(activity -> {
            int[] origin = new int[2];
            view.getLocationOnScreen(origin);
            double scale = view.getWidth() / bounds.optDouble(2);
            point[0] = origin[0] + (float) (bounds.optDouble(0) * scale);
            point[1] = origin[1] + (float) (bounds.optDouble(1) * scale);
        });
        long downTime = SystemClock.uptimeMillis();
        for (int action : new int[] {MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP}) {
            MotionEvent event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, point[0], point[1], 0);
            event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            InstrumentationRegistry.getInstrumentation().sendPointerSync(event);
            event.recycle();
            if (action == MotionEvent.ACTION_DOWN) Thread.sleep(50);
        }
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        assertTrue("JavaScript responds", evaluated.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private static void awaitCondition(WebView view, String script) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 15000;
        while (SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(view, script))) return;
            Thread.sleep(100);
        }
        assertEquals(script + "; search value: " + evaluate(view, "document.querySelector('.settingsSearch input')?.value"),
            "true", evaluate(view, script));
    }
}
