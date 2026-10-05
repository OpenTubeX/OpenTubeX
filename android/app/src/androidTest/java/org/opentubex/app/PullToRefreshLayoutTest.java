package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class PullToRefreshLayoutTest {
    @Test
    public void watchPullReloadsThePageWithSubscriptionsRetainedBehindIt() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView web = reference.get();
            await(web, "!!document.querySelector('.tabContent[aria-hidden=\"false\"]') && typeof window.__opentubexPullToRefresh === 'function'");
            await(web, "localStorage.getItem('opentubex.tutorial.audience') === 'completed' || !!document.querySelector('.tutorialActions button')");
            evaluate(web, "document.querySelector('.tutorialActions button')?.click()");
            await(web, "!document.querySelector('.tutorialOverlay')");
            evaluate(web, """
                (() => {
                    const app = document.querySelector('#app').__vue_app__.config.globalProperties;
                    window.__pullSettings = { EnablePullToRefresh: app.$store.getters.getEnablePullToRefresh,
                        FetchSubscriptionsAutomatically: app.$store.getters.getFetchSubscriptionsAutomatically };
                    app.$store.commit('setEnablePullToRefresh', true);
                    app.$store.commit('setFetchSubscriptionsAutomatically', false);
                    window.__pullFetch = window.fetch;
                    window.fetch = (url, options) => String(url).startsWith('https://localhost/')
                        ? window.__pullFetch(url, options) : Promise.reject(new Error('Offline pull-to-refresh test'));
                    app.$router.push('/subscriptions');
                })()
                """);
            try {
                await(web, "!!document.querySelector('.tabContent[aria-hidden=\"false\"] .subscriptionsHeaderRefreshWidget')");
                evaluate(web, "document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/watch/jNQXAC9IVRw')");
                await(web, "!!document.querySelector('.tabContent[aria-hidden=\"false\"] .browsingBehindWatch .subscriptionsHeaderRefreshWidget')");
                await(web, "!!window.__opentubexPullToRefresh(0.2, 0.2)");
                evaluate(web, """
                    (() => {
                        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                        window.__pullRevision = store.getters.getPresentedTab.refreshKey;
                        window.__pullRoute = store.getters.getPresentedTab.route.fullPath;
                        window.__pullFeedClicks = 0;
                        const widget = document.querySelector('.browsingBehindWatch .subscriptionsHeaderRefreshWidget').__vueParentComponent;
                        const click = widget.vnode.props.onClick;
                        widget.vnode.props.onClick = (...args) => { window.__pullFeedClicks++; return click(...args); };
                    })()
                    """);
                AtomicReference<View> layout = new AtomicReference<>();
                scenario.onActivity(activity -> layout.set((View) web.getParent()));
                swipe(layout.get(), false, false, false);
                await(web, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPresentedTab.refreshKey === window.__pullRevision + 1");
                assertEquals("Watch route remains current", "true", evaluate(web,
                    "document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPresentedTab.route.fullPath === window.__pullRoute"));
                assertEquals("The hidden subscriptions widget did not refresh its feed", "0", evaluate(web, "window.__pullFeedClicks"));
            } finally {
                evaluate(web, """
                    (() => {
                        const app = document.querySelector('#app').__vue_app__.config.globalProperties;
                        for (const [key, value] of Object.entries(window.__pullSettings)) app.$store.commit('set' + key, value);
                        window.fetch = window.__pullFetch;
                        app.$router.push('/subscriptions');
                        delete window.__pullSettings;
                        delete window.__pullFetch;
                        delete window.__pullRevision;
                        delete window.__pullRoute;
                        delete window.__pullFeedClicks;
                    })()
                    """);
            }
        }
    }

    @Test
    public void pullRequiresAnApprovedVerticalGestureAtThePageTop() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<PullToRefreshLayout> layoutRef = new AtomicReference<>();
            AtomicReference<WebView> webRef = new AtomicReference<>();
            AtomicInteger refreshes = new AtomicInteger();
            CountDownLatch loaded = new CountDownLatch(1);
            scenario.onActivity(activity -> {
                PullToRefreshLayout layout = new PullToRefreshLayout(activity, null);
                WebView web = new WebView(activity);
                web.getSettings().setJavaScriptEnabled(true);
                web.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        loaded.countDown();
                    }
                });
                layout.addView(web, new ViewGroup.LayoutParams(-1, -1));
                activity.setContentView(layout);
                layout.configure(web, true);
                layout.setOnRefreshListener(refreshes::incrementAndGet);
                layoutRef.set(layout);
                webRef.set(web);
                web.loadDataWithBaseURL("https://pull-test.invalid", "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
                    "<body style='height:5000px'><script>window.acceptPull=true;" +
                    "window.__opentubexPullToRefresh=()=>window.acceptPull?{tabId:'test',offset:0,color:'#f00',backgroundColor:'#0f0'}:null;</script></body>",
                    "text/html", "UTF-8", null);
            });
            assertTrue("page loaded", loaded.await(10, TimeUnit.SECONDS));
            PullToRefreshLayout layout = layoutRef.get();
            WebView web = webRef.get();
            try {
                swipe(layout, false, false, false);
                assertEquals("one deliberate pull refreshes", 1, refreshes.get());
                onMain(() -> {
                    assertTrue(layout.isRefreshing());
                    layout.setRefreshing(false);
                });
                SystemClock.sleep(250);

                evaluate(web, "window.acceptPull=false");
                swipe(layout, false, false, false);
                assertEquals("DOM rejection prevents refresh", 1, refreshes.get());

                evaluate(web, "window.acceptPull=true;window.scrollTo(0,300)");
                swipe(layout, false, false, false);
                assertEquals("scrolling back to the top is not a refresh", 1, refreshes.get());
                evaluate(web, "window.scrollTo(0,0)");

                swipe(layout, true, false, false);
                assertEquals("horizontal swipe does not refresh", 1, refreshes.get());
                swipe(layout, false, true, false);
                assertEquals("cancel does not refresh", 1, refreshes.get());
                swipe(layout, false, false, true);
                assertEquals("a second finger cancels refresh", 1, refreshes.get());

                swipe(layout, false, false, false);
                assertEquals("a later valid gesture still works", 2, refreshes.get());
                onMain(() -> {
                    assertTrue(layout.isRefreshing());
                    layout.setRefreshing(false);
                    layout.configure(web, false);
                });
                swipe(layout, false, false, false);
                assertEquals("disabled plugin leaves touches alone", 2, refreshes.get());
            } finally {
                onMain(() -> {
                    layout.removeView(web);
                    web.destroy();
                });
            }
        }
    }

    private static void swipe(View layout, boolean horizontal, boolean cancel, boolean multi) {
        long down = SystemClock.uptimeMillis();
        float x = layout.getWidth() * 0.2f;
        float y = layout.getHeight() * 0.2f;
        touch(layout, down, MotionEvent.ACTION_DOWN, x, y);
        // The WebView hit test must return before interception can start.
        SystemClock.sleep(150);
        for (int i = 1; i <= 20; i++) {
            float fraction = i / 20f;
            touch(layout, down, MotionEvent.ACTION_MOVE,
                x + (horizontal ? layout.getWidth() * 0.6f * fraction : 0),
                y + layout.getHeight() * (horizontal ? 0.1f : 0.6f) * fraction);
            if (multi && i == 10) touch(layout, down, MotionEvent.ACTION_POINTER_DOWN, x, y);
            SystemClock.sleep(16);
        }
        touch(layout, down, cancel ? MotionEvent.ACTION_CANCEL : MotionEvent.ACTION_UP,
            x, y + layout.getHeight() * 0.6f);
        SystemClock.sleep(500);
    }

    private static void touch(View layout, long down, int action, float x, float y) {
        onMain(() -> {
            MotionEvent event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0);
            layout.dispatchTouchEvent(event);
            event.recycle();
        });
    }

    private static void await(WebView web, String condition) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 30000;
        while (SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(web, condition))) return;
            SystemClock.sleep(100);
        }
        assertEquals(condition, "true", evaluate(web, condition));
    }

    private static String evaluate(WebView web, String script) throws Exception {
        AtomicReference<String> value = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        onMain(() -> web.evaluateJavascript(script, result -> {
            value.set(result);
            evaluated.countDown();
        }));
        assertTrue(evaluated.await(5, TimeUnit.SECONDS));
        SystemClock.sleep(100);
        return value.get();
    }

    private static void onMain(Runnable action) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(action);
    }
}
