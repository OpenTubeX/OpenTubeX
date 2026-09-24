package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PlayerScriptWorkerTest {
    @Test
    public void packagedWorkerDeciphersRealPlayerAndRecoversFromRecursion() throws Exception {
        String code;
        // AAPT expands .gz assets and removes their compression suffix.
        try (InputStream input = InstrumentationRegistry.getInstrumentation()
                .getContext().getAssets().open("7460dd14.js");
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            code = output.toString("UTF-8");
        }
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> view = new AtomicReference<>();
            scenario.onActivity(activity -> view.set(activity.getBridge().getWebView()));
            WebView webView = view.get();
            awaitCondition(webView, "!!document.querySelector('#app')?.__vue_app__");
            evaluate(webView, "window.playerFixture = " + JSONObject.quote(code));
            evaluate(webView, """
                (async () => {
                    const worker = new Worker('/player-script-worker.js');
                    const pending = new Map();
                    let nextId = 0;
                    const run = code => new Promise(resolve => {
                        const id = ++nextId;
                        pending.set(id, resolve);
                        worker.postMessage({id, code});
                    });
                    worker.onmessage = ({data}) => {
                        pending.get(data.id)?.(data);
                        pending.delete(data.id);
                    };
                    worker.onerror = event => {
                        for (const resolve of pending.values()) resolve({error: event.message});
                        pending.clear();
                    };
                    try {
                        const decoded = await Promise.all(Array.from({length: 12}, () => run(window.playerFixture)));
                        const caught = await run('function f(){return f()} try {f()} catch(e){return e.message}');
                        const uncaught = await run('function f(){return f()} f()');
                        const recovered = await run(window.playerFixture);
                        window.playerDecipherResult = {decoded, caught, uncaught, recovered};
                    } finally {
                        worker.terminate();
                        delete window.playerFixture;
                    }
                })()
                """);
            awaitCondition(webView, "window.playerDecipherResult !== undefined");
            JSONObject result = new JSONObject(evaluate(webView, "window.playerDecipherResult"));
            JSONArray decoded = result.getJSONArray("decoded");
            assertEquals(12, decoded.length());
            for (int i = 0; i < decoded.length(); i++) assertDeciphered(decoded.getJSONObject(i));
            assertEquals("stack overflow", result.getJSONObject("caught").getString("result"));
            assertEquals("InternalError: stack overflow", result.getJSONObject("uncaught").getString("error"));
            assertDeciphered(result.getJSONObject("recovered"));
        }
    }

    private static void assertDeciphered(JSONObject response) throws Exception {
        assertFalse(response.toString(), response.has("error"));
        JSONObject value = response.getJSONObject("result");
        assertEquals("mBzrJcW9e13", value.getString("n"));
        assertEquals("76543210ZYXWVUTSRQPONMLKJIHGFEDcBAzyxwvutsrqponmlkjih", value.getString("sig"));
    }

    @Test
    public void packagedWorkerInterpretsCodeWithoutWebViewAccess() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> view = new AtomicReference<>();
            scenario.onActivity(activity -> view.set(activity.getBridge().getWebView()));
            WebView webView = view.get();
            awaitCondition(webView, "!!document.querySelector('#app')?.__vue_app__");
            evaluate(webView, """
                (() => {
                    const worker = new Worker('/player-script-worker.js');
                    worker.onerror = () => {
                        window.playerWorkerResult = {error: 'worker failed'};
                        worker.terminate();
                    };
                    let first;
                    worker.onmessage = ({data}) => {
                        if (data.error) {
                            window.playerWorkerResult = {error: data.error};
                            worker.terminate();
                        } else if (data.id === 1) {
                            first = data.result;
                            worker.postMessage({id: 2, code: 'return typeof saved'});
                        } else {
                            window.playerWorkerResult = {first, second: data.result};
                            worker.terminate();
                        }
                    };
                    worker.postMessage({id: 1, code: 'globalThis.saved = 42; return {sig: "abc", n: "xyz", window: typeof window, fetch: typeof fetch, postMessage: typeof postMessage, bridge: typeof Capacitor}'});
                })()
                """);
            awaitCondition(webView, "window.playerWorkerResult !== undefined");
            JSONObject result = new JSONObject(evaluate(webView, "window.playerWorkerResult"));
            assertFalse(result.toString(), result.has("error"));
            JSONObject first = result.getJSONObject("first");
            assertEquals("abc", first.getString("sig"));
            assertEquals("xyz", first.getString("n"));
            for (String key : new String[]{"window", "fetch", "postMessage", "bridge"}) {
                assertEquals(key, "undefined", first.getString(key));
            }
            assertEquals("undefined", result.getString("second"));
        }
    }


    @Test
    public void packagedSabrEncoderKeepsRendererResponsiveAndPreservesBytes() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> view = new AtomicReference<>();
            scenario.onActivity(activity -> view.set(activity.getBridge().getWebView()));
            WebView webView = view.get();
            awaitCondition(webView, "!!document.querySelector('#app')?.__vue_app__");
            evaluate(webView, """
                (() => {
                    const worker = new Worker('/android-segment-encoder.js');
                    let ticks = 0;
                    const timer = setInterval(() => ticks++, 0);
                    const finish = result => {
                        window.sabrEncoderResult = result;
                        clearInterval(timer);
                        worker.terminate();
                    };
                    worker.onerror = event => finish({error: event.message});
                    worker.onmessage = ({data}) => {
                        if (data.error) return finish({error: data.error});
                        const decoded = atob(data.data);
                        let valid = decoded.length === 4 * 1024 * 1024;
                        for (let i = 0; valid && i < decoded.length; i++) valid = decoded.charCodeAt(i) === i % 251;
                        finish({valid, ticks, id: data.id});
                    };
                    const bytes = new Uint8Array(4 * 1024 * 1024);
                    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
                    worker.postMessage({id: 7, bytes}, [bytes.buffer]);
                })()
                """);
            awaitCondition(webView, "window.sabrEncoderResult !== undefined");
            JSONObject result = new JSONObject(evaluate(webView, "window.sabrEncoderResult"));
            assertFalse(result.toString(), result.has("error"));
            assertTrue(result.toString(), result.getBoolean("valid"));
            assertEquals(7, result.getInt("id"));
            assertTrue("Renderer timers must run during encoding: " + result, result.getInt("ticks") > 0);
        }
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        assertTrue("WebView responds", evaluated.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private static void awaitCondition(WebView view, String script) throws Exception {
        long deadline = android.os.SystemClock.uptimeMillis() + 20000;
        while (android.os.SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(view, script))) return;
            Thread.sleep(100);
        }
        assertEquals(script, "true", evaluate(view, script));
    }
}
