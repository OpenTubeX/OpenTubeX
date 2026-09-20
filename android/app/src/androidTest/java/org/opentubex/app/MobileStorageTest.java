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
    public void rendererHistoryUpdatesUseIndividualIndexedDbRecords() throws Exception {
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
                        const database = await new Promise((resolve,reject) => {
                            const request = indexedDB.open('opentubex-records-history.db');
                            request.onsuccess = () => resolve(request.result);
                            request.onerror = () => reject(request.error);
                        });
                        try {
                            const records = await new Promise((resolve,reject) => {
                                const request = database.transaction('records').objectStore('records').getAll();
                                request.onsuccess = () => resolve(request.result.map(JSON.parse));
                                request.onerror = () => reject(request.error);
                            });
                            window.__storageTest = records.filter(record => record.videoId === videoId).map(record => record.watchProgress);
                        } finally { database.close(); }
                    } catch(error) { window.__storageTest = String(error); }
                    finally { await store.dispatch('removeFromHistory', videoId); }
                })();
                """);
            awaitCondition(webView, "window.__storageTest !== null");
            assertEquals("[42]", evaluate(webView, "window.__storageTest"));
        }
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        if (!evaluated.await(5, TimeUnit.SECONDS)) return null;
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
