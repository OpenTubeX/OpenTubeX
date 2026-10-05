package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PlaylistTouchReorderTest {
    private static final String APP = "document.querySelector('#app').__vue_app__.config.globalProperties";
    private static final String ID = "touch-reorder-regression";

    @Test
    public void handleDragKeepsRowVisibleAndPersistsOrder() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            await(view, "!!document.querySelector('#app')?.__vue_app__ && !!document.querySelector('.profileTrigger')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            await(view, "!document.querySelector('.tutorialOverlay')");
            evaluate(view, """
                (async () => {
                    const app = document.querySelector('#app').__vue_app__.config.globalProperties;
                    const store = app.$store;
                    window.playlistTouchOriginal = {
                        route: app.$router.currentRoute.value.fullPath,
                        layout: store.getters.getPlaylistViewType,
                        sort: store.getters.getUserPlaylistSortOrder,
                        scale: store.getters.getUiScale,
                        bookmark: store.getters.getQuickBookmarkTargetPlaylistId
                    };
                    await store.dispatch('addPlaylist', {
                        _id: 'touch-reorder-regression', playlistName: 'Touch reorder regression',
                        protected: false, description: '',
                        videos: Array.from({ length: 6 }, (_, i) => ({
                            videoId: String(i).padStart(11, '0'), playlistItemId: 'touch-item-' + i,
                            title: 'Touch video ' + i, author: 'Test', lengthSeconds: 120, type: 'video'
                        }))
                    });
                    store.commit('setUserPlaylistSortOrder', 'custom');
                    await app.$router.push('/playlist/touch-reorder-regression?playlistType=user');
                })()
                """);
            try {
                for (int scale : new int[] {100, 95}) {
                    evaluate(view, APP + ".$store.commit('setPlaylistViewType', 'list');" +
                        APP + ".$store.commit('setUiScale', " + scale + "); window.scrollTo(0, 0)");
                    await(view, "document.querySelectorAll('.playlistItemsCard .grabBar').length >= 3");
                    Thread.sleep(250);
                    String row = ".playlistItems > .draggable";
                    evaluate(view, "document.querySelector('" + row + "').scrollIntoView({block: 'center'});");
                    Thread.sleep(250);
                    evaluate(view, "window.touchSecond = document.querySelectorAll('" + row + " .h3Title')[1].textContent.trim()");
                    float[] start = point(view, row + " .grabBar", true);
                    float[] end = point(view, row, false);
                    long downTime = SystemClock.uptimeMillis();
                    touch(downTime, MotionEvent.ACTION_DOWN, start[0], start[1]);
                    try {
                        Thread.sleep(800);
                        for (int step = 1; step <= 20; step++) {
                            touch(downTime, MotionEvent.ACTION_MOVE,
                                start[0] + (end[0] - start[0]) * step / 20f,
                                start[1] + (end[1] - start[1]) * step / 20f);
                            Thread.sleep(30);
                        }
                        assertEquals("Dragged row remains visible at " + scale + "%", "true",
                            evaluate(view, "!!document.querySelector('.playlistItemsCard .draggedVideo') && " +
                                "Number(getComputedStyle(document.querySelector('.playlistItemsCard .draggedVideo')).opacity) > 0"));
                    } finally {
                        touch(downTime, MotionEvent.ACTION_UP, end[0], end[1]);
                    }
                    await(view, "!document.querySelector('.playlistItemsCard .draggedVideo') && " +
                        "document.querySelector('" + row + " .h3Title').textContent.trim() === window.touchSecond");
                    await(view, APP + ".$store.getters.getPlaylist('" + ID + "').videos[0].title === window.touchSecond");
                    evaluate(view, APP + ".$router.push('/userplaylists')");
                    await(view, "!document.querySelector('.playlistItemsCard')");
                    evaluate(view, APP + ".$router.push('/playlist/" + ID + "?playlistType=user')");
                    await(view, "document.querySelector('" + row + " .h3Title')?.textContent.trim() === window.touchSecond");
                }
            } finally {
                evaluate(view, """
                    (async () => {
                        const app = document.querySelector('#app').__vue_app__.config.globalProperties;
                        const saved = window.playlistTouchOriginal;
                        await app.$router.push(saved.route);
                        await app.$store.dispatch('removePlaylist', 'touch-reorder-regression');
                        app.$store.commit('setPlaylistViewType', saved.layout);
                        app.$store.commit('setUserPlaylistSortOrder', saved.sort);
                        app.$store.commit('setUiScale', saved.scale);
                        await app.$store.dispatch('updateQuickBookmarkTargetPlaylistId', saved.bookmark);
                        window.playlistTouchRestored = true;
                    })()
                    """);
                await(view, "window.playlistTouchRestored === true");
            }
        }
    }

    private static float[] point(WebView view, String selector, boolean first) throws Exception {
        JSONArray rect = new JSONArray(evaluate(view, "(() => { const rows = document.querySelectorAll('" + selector + "');" +
            "const r = rows[" + (first ? "0" : "1") + "].getBoundingClientRect();" +
            "return [r.left + r.width / 2, r.top + r.height / 2, innerWidth]; })()"));
        int[] origin = new int[2];
        float[] dimensions = new float[2];
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            view.getLocationOnScreen(origin);
            dimensions[0] = view.getWidth();
            dimensions[1] = view.getHeight();
        });
        float ratio = dimensions[0] / (float) rect.getDouble(2);
        float y = (float) rect.getDouble(1) * ratio;
        assertTrue("Touch point is inside WebView: " + rect + " height=" + dimensions[1] + " ratio=" + ratio,
            y > 0 && y < dimensions[1]);
        return new float[] {origin[0] + (float) rect.getDouble(0) * ratio, origin[1] + y};
    }

    private static void touch(long downTime, int action, float x, float y) {
        MotionEvent event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, x, y, 0);
        event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(event, true);
        event.recycle();
    }

    private static String evaluate(WebView view, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            latch.countDown();
        }));
        assertTrue("JavaScript responds", latch.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private static void await(WebView view, String script) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 15000;
        do {
            if ("true".equals(evaluate(view, script))) return;
            Thread.sleep(100);
        } while (SystemClock.uptimeMillis() < deadline);
        assertEquals(script, "true", evaluate(view, script));
    }
}
