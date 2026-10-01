package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.os.SystemClock;
import android.util.Log;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NavigationResponsivenessTest {
    @Test
    public void returningToSubscriptionsReusesTheProcessedFeed() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            await(view, "!!document.querySelector('.sideNav a[href=\"#/userplaylists\"]')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            await(view, "!document.querySelector('.tutorialOverlay')");
            evaluate(view, """
                (() => {
                    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                    window.navigationSavedState = JSON.parse(JSON.stringify(store.state));
                    window.navigationSavedFeed = localStorage.getItem('Subscriptions/currentTab');
                    store.commit('setFetchSubscriptionsAutomatically', false);
                    store.commit('setHideSubscriptionsVideos', false);
                    store.commit('setHideSubscriptionsShorts', true);
                    store.commit('setHideSubscriptionsLive', true);
                    store.commit('setHideSubscriptionsCommunity', true);
                    const subscriptions = Array.from({ length: 300 }, (_, index) => ({
                        id: 'UC' + String(index).padStart(22, '0'), name: 'Channel ' + index, thumbnail: ''
                    }));
                    store.commit('setProfileList', [{ _id: 'allChannels', name: 'All Channels',
                        bgColor: '#000000', textColor: '#FFFFFF', subscriptions }]);
                    store.commit('setActiveProfile', 'allChannels');
                    store.commit('setCaches', {
                        videos: Object.fromEntries(subscriptions.map((channel, index) => [channel.id, {
                            timestamp: new Date(),
                            videos: Array.from({ length: 36 }, (_, video) => ({
                                videoId: 'navigation-' + index + '-' + video, title: 'Video ' + index + '-' + video,
                                authorId: channel.id, author: channel.name, type: 'video', lengthSeconds: 120,
                                published: Date.now() - (video * 300 + index) * 3600000,
                                isNewInSubscriptionFeed: true, liveNow: false, isUpcoming: false
                            }))
                        }])), liveStreams: {}, shorts: {}, communityPosts: {}
                    });
                    store.commit('setSubscriptionCacheReady', true);
                    localStorage.setItem('Subscriptions/currentTab', 'videos');
                    document.querySelector('.sideNav .inner > a[href="#/userplaylists"]').click();
                })()
                """);
            try {
                await(view, "!!document.querySelector('.newPlaylistButton')");
                tap(view, "subscriptions");
                await(view, "!!document.querySelector('#subscriptionsPanel .ft-list-video')");
                evaluate(view, "document.querySelector('.sideNav .inner > a[href=\"#/userplaylists\"]').click()");
                await(view, "!!document.querySelector('.newPlaylistButton')");
                evaluate(view, """
                    window.navigationSort = Array.prototype.sort;
                    window.navigationSorts = 0;
                    window.navigationElapsed = null;
                    Array.prototype.sort = function(...args) {
                        if (this.length >= 10000) window.navigationSorts++;
                        return window.navigationSort.apply(this, args);
                    };
                    document.querySelector('.sideNav .inner > a[href="#/subscriptions"]').addEventListener('pointerup', () => {
                        const start = performance.now();
                        function rendered() {
                            if (document.querySelector('#subscriptionsPanel .ft-list-video')) {
                                window.navigationElapsed = performance.now() - start;
                            } else requestAnimationFrame(rendered);
                        }
                        requestAnimationFrame(rendered);
                    }, { once: true });
                    """);
                tap(view, "subscriptions");
                await(view, "window.navigationElapsed !== null");
                Log.i("NavigationResponsiveness", "tap-to-render ms: " + evaluate(view, "window.navigationElapsed"));
                assertEquals("An unchanged feed must not sort its entire cache after a tab switch", "0",
                    evaluate(view, "window.navigationSorts"));
            } finally {
                evaluate(view, """
                    if (window.navigationSort) Array.prototype.sort = window.navigationSort;
                    document.querySelector('#app').__vue_app__.config.globalProperties.$store.replaceState(window.navigationSavedState);
                    if (window.navigationSavedFeed === null) localStorage.removeItem('Subscriptions/currentTab');
                    else localStorage.setItem('Subscriptions/currentTab', window.navigationSavedFeed);
                    for (const key of ['navigationSort', 'navigationSorts', 'navigationElapsed', 'navigationSavedState', 'navigationSavedFeed']) delete window[key];
                    """);
            }
        }
    }

    private static void tap(WebView view, String route) throws Exception {
        String selector = ".sideNav .inner > a[href=\"#/" + route + "\"]";
        float x = Float.parseFloat(evaluate(view, "(() => { const r = document.querySelector('" + selector + "').getBoundingClientRect(); return (r.left + r.right) / 2 })()"));
        float y = Float.parseFloat(evaluate(view, "(() => { const r = document.querySelector('" + selector + "').getBoundingClientRect(); return (r.top + r.bottom) / 2 })()"));
        float scale = view.getWidth() / Float.parseFloat(evaluate(view, "window.innerWidth"));
        long downTime = SystemClock.uptimeMillis();
        for (int action : new int[] { MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP }) {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                MotionEvent event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, x * scale, y * scale, 0);
                event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                view.dispatchTouchEvent(event);
                event.recycle();
            });
        }
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            done.countDown();
        }));
        assertTrue("WebView responds", done.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private static void await(WebView view, String script) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 30000;
        while (SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(view, script))) return;
            Thread.sleep(100);
        }
        assertEquals(script, "true", evaluate(view, script));
    }
}
