package org.opentubex.app;

import static org.junit.Assert.assertEquals;
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
public class MobileStorageTest {
    @Test
    public void rendererHistorySurvivesWebViewStorageEviction() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> view = new AtomicReference<>();
            scenario.onActivity(activity -> view.set(activity.getBridge().getWebView()));
            WebView webView = view.get();
            awaitCondition(webView, "!!document.querySelector('.app')");
            evaluate(webView, """
                window.__storageTest = null;
                (async () => {
                    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                    const videoId = 'storage-test-video';
                    try {
                        await store.dispatch('updateWatchProgress', {videoId,watchProgress:12});
                        await store.dispatch('updateWatchProgress', {videoId,watchProgress:42});
                        // Libraries live in native SQLite, so losing WebView storage must not lose them.
                        await Promise.all((await indexedDB.databases()).map(({name}) => new Promise((resolve, reject) => {
                            const request = indexedDB.deleteDatabase(name);
                            request.onsuccess = resolve;
                            request.onerror = () => reject(request.error);
                        })));
                        window.__storageTest = 'evicted';
                    } catch(error) { window.__storageTest = String(error); }
                })();
                """);
            awaitCondition(webView, "window.__storageTest !== null");
            assertEquals("\"evicted\"", evaluate(webView, "window.__storageTest"));
            evaluate(webView, "window.__beforeReload = true");
            scenario.onActivity(activity -> webView.reload());
            awaitCondition(webView, "!window.__beforeReload && " +
                "document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store.getters" +
                ".getHistoryCacheById['storage-test-video']?.watchProgress === 42");
            evaluate(webView, "document.querySelector('#app').__vue_app__.config.globalProperties.$store" +
                ".dispatch('removeFromHistory', 'storage-test-video')");
        }
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        if (!evaluated.await(15, TimeUnit.SECONDS)) return null;
        return result.get();
    }

    private static void awaitCondition(WebView view, String script) throws Exception {
        long deadline = android.os.SystemClock.uptimeMillis() + 15000;
        while (android.os.SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(view, script))) return;
            Thread.sleep(100);
        }
        assertEquals(script, "true", evaluate(view, script));
    }
}
