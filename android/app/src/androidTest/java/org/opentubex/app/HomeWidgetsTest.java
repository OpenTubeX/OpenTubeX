package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class HomeWidgetsTest {
    private static final String STORE = "document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store";

    @Test
    public void quickAccessOpensItsPagesOnStartupAndInTheRunningApp() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(pageIntent(context, "subscriptions"))) {
            await(scenario, "location.hash === '#/subscriptions'");
            skipTutorial(scenario);
            context.startActivity(pageIntent(context, "watch-later"));
            await(scenario, "location.hash === '#/playlist/watchLater?playlistType=user'");
            context.startActivity(pageIntent(context, "search"));
            await(scenario, "document.activeElement?.closest('.searchInput') != null");
        }
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(pageIntent(context, "search"))) {
            // A cold start opens the link before the top navigation is mounted.
            await(scenario, "document.activeElement?.closest('.searchInput') != null");
        }
    }

    @Test
    public void continueWatchingFollowsHistoryAndResumesAtTheSavedPosition() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            await(scenario, STORE + "?.state.history.continueWatchingRevision > 0");
            skipTutorial(scenario);
            evaluate(scenario, "void " + STORE + ".dispatch('updateHistory', { videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', " +
                "author: 'jawed', lengthSeconds: 19, watchProgress: 7.5, timeWatched: Date.now(), isWatched: false, type: 'video' })");
            HomeWidgets.Video video = awaitFirstVideo(context, "jNQXAC9IVRw");
            assertEquals("Me at the zoo", video.title());
            assertEquals("jawed", video.author());
            assertEquals(7, video.progress());
            assertEquals(19, video.length());

            Intent intent = HomeWidgets.videoIntent(context, video).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            assertEquals("https://www.youtube.com/watch?v=jNQXAC9IVRw&t=7s", intent.getDataString());
            context.startActivity(intent);
            await(scenario, "location.hash.startsWith('#/watch/jNQXAC9IVRw') && location.hash.includes('timestamp=7')");

            // The watch page saves its video to history, so leave it first.
            evaluate(scenario, "location.hash = '#/subscriptions'");
            await(scenario, "location.hash === '#/subscriptions'");
            evaluate(scenario, "void " + STORE + ".dispatch('removeFromHistory', 'jNQXAC9IVRw')");
            awaitFirstVideo(context, null);
        }
    }

    @Test
    public void storedVideosAreValidatedAndLimited() throws Exception {
        JSONArray videos = new JSONArray()
            .put(new JSONObject().put("videoId", "../../files").put("title", "Path"))
            .put(new JSONObject().put("videoId", "jNQXAC9IVRw").put("thumbnail", "http://i.ytimg.com/vi/jNQXAC9IVRw/mqdefault.jpg"))
            .put(new JSONObject().put("videoId", "dQw4w9WgXcQ").put("thumbnail", "https://127.0.0.1/thumbnail.jpg"));
        for (int index = 0; index < 5; index++) videos.put(new JSONObject().put("videoId", "aaaaaaaaaa" + index));
        List<HomeWidgets.Video> parsed = HomeWidgets.parse(videos);
        assertEquals(HomeWidgets.MAX_VIDEOS, parsed.size());
        assertEquals("jNQXAC9IVRw", parsed.get(0).id());
        assertEquals("Thumbnails require HTTPS", "", parsed.get(0).thumbnail());
        assertEquals("Thumbnails must not target the device's network", "", parsed.get(1).thumbnail());
    }

    @Test
    public void rowsFollowTheWidgetHeight() {
        assertEquals(2, HomeWidgets.rows(null));
        assertEquals(1, HomeWidgets.rows(height(110)));
        assertEquals(2, HomeWidgets.rows(height(180)));
        assertEquals(HomeWidgets.MAX_VIDEOS, HomeWidgets.rows(height(800)));
    }

    private static void skipTutorial(ActivityScenario<MainActivity> scenario) throws Exception {
        await(scenario, "document.querySelector('.tutorialActions button') || !document.querySelector('.tutorialOverlay')");
        evaluate(scenario, "document.querySelector('.tutorialActions button')?.click()");
        await(scenario, "!document.querySelector('.tutorialOverlay')");
    }

    private static Bundle height(int dp) {
        Bundle options = new Bundle();
        options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, dp);
        return options;
    }

    private static Intent pageIntent(Context context, String page) {
        return HomeWidgets.pageIntent(context, page).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    private static HomeWidgets.Video awaitFirstVideo(Context context, String id) throws Exception {
        long deadline = System.currentTimeMillis() + 15000;
        List<HomeWidgets.Video> videos = List.of();
        while (System.currentTimeMillis() < deadline) {
            videos = HomeWidgets.continueWatching(context);
            boolean matching = id == null
                ? videos.stream().noneMatch(video -> video.id().equals("jNQXAC9IVRw"))
                : !videos.isEmpty() && videos.get(0).id().equals(id);
            if (matching) return id == null ? null : videos.get(0);
            Thread.sleep(100);
        }
        throw new AssertionError("Widget videos were not updated: " + videos);
    }

    private static void await(ActivityScenario<MainActivity> scenario, String expression) throws Exception {
        long deadline = System.currentTimeMillis() + 45000;
        String actual = null;
        while (System.currentTimeMillis() < deadline) {
            actual = evaluate(scenario, "!!(" + expression + ")");
            if ("true".equals(actual)) return;
            Thread.sleep(100);
        }
        assertEquals(expression, "true", actual);
    }

    private static String evaluate(ActivityScenario<MainActivity> scenario, String expression) throws Exception {
        CountDownLatch evaluated = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(expression, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        assertTrue("WebView responded", evaluated.await(5, TimeUnit.SECONDS));
        return result.get();
    }
}
