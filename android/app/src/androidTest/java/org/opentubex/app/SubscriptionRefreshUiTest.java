package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.NotificationManager;
import android.content.Context;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;
import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class SubscriptionRefreshUiTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private static final String STORE = "document.querySelector('#app').__vue_app__.config.globalProperties.$store";

    @Test
    public void externalRendererProgressLimitsCacheReloadsAndFlushesOnCompletion() throws Exception {
        String token = "retained-ui-throttle-test";
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            await(view, "!!document.querySelector('.app') && " + STORE + ".getters.getSubscriptionCacheReady");
            evaluate(view, """
                window.__refreshReloadTimes = [];
                window.__stopRefreshReloadCount = %s.subscribeAction(action => {
                    if (action.type === 'grabAllSubscriptions') window.__refreshReloadTimes.push(performance.now());
                });
                """.replace("%s", STORE));
            try {
                // Native ownership belongs to another renderer, not this WebView's plugin.
                assertTrue(SubscriptionRefreshWorker.start(context, token, "Refreshing subscriptions", "Cancel"));
                SubscriptionRefreshCoordinator.update(token, "videos", 0);
                evaluate(view, "document.dispatchEvent(new Event('visibilitychange'))");
                await(view, "window.__refreshReloadTimes.length === 1");
                for (int progress = 1; progress <= 12; progress++) {
                    SubscriptionRefreshCoordinator.setProgress(token, progress);
                    await(view, STORE + ".getters.getSubscriptionFeedRefreshProgress === " + progress);
                }
                assertEquals("cache reloads are spaced five seconds apart", "true", evaluate(view,
                    "window.__refreshReloadTimes.slice(1).every((time, index) => time - window.__refreshReloadTimes[index] >= 5000)"));
                int reloads = Integer.parseInt(evaluate(view, "window.__refreshReloadTimes.length"));
                assertTrue("long refresh still imports intermediate cache writes", reloads >= 2);
                SubscriptionRefreshWorker.finish(context, token);
                await(view, "!" + STORE + ".getters.getSubscriptionFeedRefreshInProgress && window.__refreshReloadTimes.length === " + (reloads + 1));
                android.util.Log.i("RefreshUiTest", "12 live progress updates, " + reloads + " cache reloads plus one completion reload");
            } finally {
                SubscriptionRefreshWorker.finish(context, token);
                evaluate(view, "window.__stopRefreshReloadCount?.()");
            }
        }
    }

    @Test
    public void reopenedUiFollowsNativeRefreshAndImportsVideosBeforeCompletion() throws Exception {
        String token = "scheduled-ui-test";
        String channelId = "UC-refresh-ui-test";
        assertTrue(SubscriptionRefreshCoordinator.begin(token));
        SubscriptionRefreshCoordinator.update(token, "videos", 42);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            try {
                await(view, "!!document.querySelector('.app') && " + STORE + ".getters.getSubscriptionCacheReady");
                await(view, STORE + ".getters.getSubscriptionFeedRefreshInProgress && " +
                    STORE + ".getters.getSubscriptionFeedRefreshProgress === 42");
                assertFalse("no refresh notification in the app", Arrays.stream(
                    context.getSystemService(NotificationManager.class).getActiveNotifications())
                    .anyMatch(notification -> notification.getId() == SubscriptionRefreshNotification.NOTIFICATION_ID));
                evaluate(view, """
                    window.__refreshUiReady = false;
                    (async () => {
                        const store = %s;
                        window.__refreshUiActiveProfile = store.getters.getActiveProfile._id;
                        window.__refreshUiProfile = JSON.parse(JSON.stringify(store.getters.profileById('allChannels')));
                        await store.dispatch('updateProfile', {
                            ...window.__refreshUiProfile,
                            subscriptions: [...window.__refreshUiProfile.subscriptions,
                                { id: 'UC-refresh-ui-test', name: 'Refresh test channel', thumbnail: '' }]
                        });
                        await store.dispatch('updateActiveProfile', 'allChannels');
                        document.querySelector('.tutorialActions button')?.click();
                        await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/subscriptions?tab=videos');
                        window.__refreshUiReady = true;
                    })();
                    """.replace("%s", STORE));
                await(view, "window.__refreshUiReady");
                JSONObject video = new JSONObject()
                    .put("videoId", "refresh-ui-video")
                    .put("title", "New video received during background refresh")
                    .put("author", "Refresh test channel")
                    .put("authorId", channelId)
                    .put("published", System.currentTimeMillis())
                    .put("lengthSeconds", 120)
                    .put("viewCount", 100)
                    .put("type", "video");
                SubscriptionRefreshResultStore.writeChannel(context, "allChannels", "videos", channelId,
                    new JSONObject().put("backgroundFormat", "entries").put("entries", new JSONArray().put(video)),
                    System.currentTimeMillis());
                SubscriptionRefreshCoordinator.setProgress(token, 73);
                await(view, STORE + ".getters.getSubscriptionFeedRefreshProgress === 73 && " +
                    STORE + ".getters.getVideoCache['UC-refresh-ui-test']?.videos[0]?.videoId === 'refresh-ui-video'");
                assertTrue("video arrives while the original worker still owns refresh", SubscriptionRefreshCoordinator.isCurrent(token));
                await(view, "document.body.innerText.includes('New video received during background refresh')");
                File screenshot = new File(context.getExternalFilesDir(null), "android-refresh-reopened.png");
                try (FileOutputStream output = new FileOutputStream(screenshot)) {
                    InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot()
                        .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output);
                }
                evaluate(view, "document.querySelector('.refreshButton button').click()");
                long cancellationDeadline = android.os.SystemClock.elapsedRealtime() + 5000;
                while (!SubscriptionRefreshCoordinator.isCancelled(token) &&
                    android.os.SystemClock.elapsedRealtime() < cancellationDeadline) Thread.sleep(50);
                assertTrue("the in-app Cancel action reaches the native worker", SubscriptionRefreshCoordinator.isCancelled(token));
                SubscriptionRefreshCoordinator.finish(token);
                await(view, "!" + STORE + ".getters.getSubscriptionFeedRefreshInProgress");
                assertEquals("0", evaluate(view, STORE + ".getters.getSubscriptionFeedRefreshProgress"));
            } finally {
                SubscriptionRefreshCoordinator.finish(token);
                evaluate(view, """
                    window.__refreshUiCleaned = false;
                    (async () => {
                        const store = %s;
                        if (window.__refreshUiProfile) await store.dispatch('updateProfile', window.__refreshUiProfile);
                        if (window.__refreshUiActiveProfile) await store.dispatch('updateActiveProfile', window.__refreshUiActiveProfile);
                        await store.dispatch('clearSubscriptionsCacheForManyChannels', ['UC-refresh-ui-test']);
                        window.__refreshUiCleaned = true;
                    })();
                    """.replace("%s", STORE));
                await(view, "window.__refreshUiCleaned");
                SubscriptionRefreshResultStore.forgetFingerprints(context, Collections.singleton(channelId));
            }
        } finally {
            SubscriptionRefreshCoordinator.finish(token);
        }
    }

    private static void await(WebView view, String expression) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + 15000;
        while (!"true".equals(evaluate(view, "Boolean(" + expression + ")"))) {
            if (android.os.SystemClock.elapsedRealtime() >= deadline) throw new AssertionError(expression + "; page=" + evaluate(view, "JSON.stringify({text: document.body.innerText.slice(0, 1500), feed: " + STORE + ".getters.getSubscriptionVideosFeed.videos, group: " + STORE + ".getters.getActiveSubscriptionGroup, profile: " + STORE + ".getters.getActiveProfile, hidden: document.hidden})"));
            Thread.sleep(50);
        }
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        assertTrue("WebView executes JavaScript", evaluated.await(5, TimeUnit.SECONDS));
        return result.get();
    }
}
