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
        assertFeedNavigation("subscriptions", "#subscriptionsPanel .ft-list-video");
    }

    @Test
    public void homeShelvesMountOnlyTheVisibleCards() throws Exception {
        assertFeedNavigation("home", "[data-home-section=\"newSinceLastVisit\"] .mediaGrid li");
    }

    private static void assertFeedNavigation(String route, String contentSelector) throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            await(view, "!!document.querySelector('.sideNav a[href=\"#/userplaylists\"]')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            await(view, "!document.querySelector('.tutorialOverlay')");
            evaluate(view, "document.querySelector('.sideNav .inner > a[href=\"#/userplaylists\"]').click()");
            await(view, "!!document.querySelector('.newPlaylistButton')");
            evaluate(view, """
                (() => {
                    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                    window.navigationSavedState = {
                        ...store.state,
                        settings: { ...store.state.settings },
                        profiles: { ...store.state.profiles },
                        subscriptionCache: { ...store.state.subscriptionCache }
                    };
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
                if (route.equals("home")) {
                    evaluate(view, """
                        window.navigationHomeOverflow = false;
                        window.navigationHomeObserver = new MutationObserver(() => {
                            const shelf = document.querySelector('[data-home-section="newSinceLastVisit"] [data-home-shelf]');
                            if (shelf === null) return;
                            // Bound a full row using fractional CSS width; controls reduce its capacity further.
                            const capacity = Math.max(1, Math.floor((shelf.getBoundingClientRect().width + 12) / (260 + 12)));
                            if (shelf.querySelectorAll('.mediaGrid li').length > capacity) window.navigationHomeOverflow = true;
                        });
                        window.navigationHomeObserver.observe(document.querySelector('#app'), { childList: true, subtree: true });
                        """);
                }
                tap(view, route);
                await(view, "!!document.querySelector('" + contentSelector + "')");
                evaluate(view, "document.querySelector('.sideNav .inner > a[href=\"#/userplaylists\"]').click()");
                await(view, "!!document.querySelector('.newPlaylistButton')");
                evaluate(view, String.format("""
                    window.navigationContentSelector = '%s';
                    window.navigationSort = Array.prototype.sort;
                    window.navigationSorts = 0;
                    window.navigationElapsed = null;
                    Array.prototype.sort = function(...args) {
                        if (this.length >= 10000) window.navigationSorts++;
                        return window.navigationSort.apply(this, args);
                    };
                    document.querySelector('.sideNav .inner > a[href="#/%s"]').addEventListener('pointerup', () => {
                        const start = performance.now();
                        function rendered() {
                            if (document.querySelector(window.navigationContentSelector)) {
                                window.navigationElapsed = performance.now() - start;
                            } else requestAnimationFrame(rendered);
                        }
                        requestAnimationFrame(rendered);
                    }, { once: true });
                    """, contentSelector, route));
                tap(view, route);
                await(view, "window.navigationElapsed !== null");
                Log.i("NavigationResponsiveness", route + " tap-to-render ms: " + evaluate(view, "window.navigationElapsed"));
                if (route.equals("home")) {
                    assertEquals("Home must not mount more than a row of cards before measuring its width", "false",
                        evaluate(view, "window.navigationHomeOverflow"));
                } else {
                    assertEquals("An unchanged feed must not sort its entire cache after a tab switch", "0",
                        evaluate(view, "window.navigationSorts"));
                }
            } finally {
                evaluate(view, """
                    if (window.navigationSort) Array.prototype.sort = window.navigationSort;
                    window.navigationHomeObserver?.disconnect();
                    document.querySelector('#app').__vue_app__.config.globalProperties.$store.replaceState(window.navigationSavedState);
                    if (window.navigationSavedFeed === null) localStorage.removeItem('Subscriptions/currentTab');
                    else localStorage.setItem('Subscriptions/currentTab', window.navigationSavedFeed);
                    for (const key of ['navigationSort', 'navigationSorts', 'navigationElapsed', 'navigationSavedState', 'navigationSavedFeed', 'navigationContentSelector', 'navigationHomeObserver', 'navigationHomeOverflow']) delete window[key];
                    """);
            }
            assertEquals("Restored playlist counts retain their Map type", "true", evaluate(view,
                "document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPlaylistVideoCounts instanceof Map"));
            assertEquals("Restored prompts retain their Set type", "true", evaluate(view,
                "document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.utils.openPrompts instanceof Set"));
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
