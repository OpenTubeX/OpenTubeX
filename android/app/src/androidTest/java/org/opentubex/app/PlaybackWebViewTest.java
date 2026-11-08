package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.view.View;
import android.view.MotionEvent;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class PlaybackWebViewTest {
    @Test
    public void playingPageStaysVisibleWhileItsWindowIsHidden() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<SubscriptionRefreshWebView> view = new AtomicReference<>();
            scenario.onActivity(activity -> {
                SubscriptionRefreshWebView webView = (SubscriptionRefreshWebView) activity.getBridge().getWebView();
                view.set(webView);
                webView.loadUrl("about:blank");
            });
            try {
                assertVisibility(view.get(), "visible");
                onMain(() -> view.get().onWindowVisibilityChanged(View.GONE));
                assertVisibility(view.get(), "hidden");
                onMain(() -> SubscriptionRefreshWebView.setPlaybackActive(true));
                assertVisibility(view.get(), "visible");
                onMain(() -> SubscriptionRefreshWebView.setPlaybackActive(false));
                assertVisibility(view.get(), "hidden");
            } finally {
                onMain(() -> {
                    SubscriptionRefreshWebView.setPlaybackActive(false);
                    view.get().onWindowVisibilityChanged(View.VISIBLE);
                });
            }
        }
    }

    @Test
    public void webViewVideoContinuesWhileItsWindowIsHidden() throws Exception {
        byte[] media;
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("demo.webm");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            for (int count; (count = input.read(buffer)) != -1; ) output.write(buffer, 0, count);
            media = output.toByteArray();
        }
        String html = "<video id='video' autoplay src='data:video/webm;base64," +
            android.util.Base64.encodeToString(media, android.util.Base64.NO_WRAP) + "'></video>";
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<SubscriptionRefreshWebView> view = new AtomicReference<>();
            scenario.onActivity(activity -> {
                SubscriptionRefreshWebView webView = (SubscriptionRefreshWebView) activity.getBridge().getWebView();
                view.set(webView);
                webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
                webView.loadDataWithBaseURL("https://playback-test.invalid/", html, "text/html", "UTF-8", null);
            });
            try {
                waitForPlayback(view.get());
                assertEquals("false", evaluate(view.get(), "document.querySelector('video').muted"));
                double before = Double.parseDouble(evaluate(view.get(), "document.querySelector('video').currentTime"));
                onMain(() -> SubscriptionRefreshWebView.setPlaybackActive(true));
                scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
                assertVisibility(view.get(), "visible");
                Thread.sleep(2000);
                double after = Double.parseDouble(evaluate(view.get(), "document.querySelector('video').currentTime"));
                assertTrue("WebView media continues behind the lock screen", after > before + 1);
            } finally {
                onMain(() -> SubscriptionRefreshWebView.setPlaybackActive(false));
                scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            }
        }
    }

    @Test
    public void fullscreenSurvivesReplacingThePlayerElement() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<SubscriptionRefreshWebView> view = new AtomicReference<>();
            scenario.onActivity(activity -> {
                SubscriptionRefreshWebView webView = (SubscriptionRefreshWebView) activity.getBridge().getWebView();
                view.set(webView);
                webView.loadDataWithBaseURL("https://playback-test.invalid/",
                    "<div id='watch'><button id='enter' style='position:fixed;inset:0;width:100%;height:100%' onclick='document.querySelector(\"#watch\").requestFullscreen()'>Fullscreen</button><div id='player'>Player</div></div>",
                    "text/html", "UTF-8", null);
            });

            long deadline = android.os.SystemClock.uptimeMillis() + 5000;
            while (android.os.SystemClock.uptimeMillis() < deadline &&
                !"true".equals(evaluate(view.get(), "Boolean(document.querySelector('#enter'))"))) {
                Thread.sleep(100);
            }
            int[] origin = new int[2];
            int[] size = new int[2];
            onMain(() -> {
                view.get().getLocationOnScreen(origin);
                size[0] = view.get().getWidth();
                size[1] = view.get().getHeight();
            });
            long now = android.os.SystemClock.uptimeMillis();
            float x = origin[0] + size[0] / 2f;
            float y = origin[1] + size[1] / 2f;
            MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0);
            MotionEvent up = MotionEvent.obtain(now, now + 50, MotionEvent.ACTION_UP, x, y, 0);
            InstrumentationRegistry.getInstrumentation().sendPointerSync(down);
            InstrumentationRegistry.getInstrumentation().sendPointerSync(up);
            down.recycle();
            up.recycle();

            deadline = android.os.SystemClock.uptimeMillis() + 5000;
            while (android.os.SystemClock.uptimeMillis() < deadline &&
                !"true".equals(evaluate(view.get(), "document.fullscreenElement?.id === 'watch'"))) {
                Thread.sleep(100);
            }
            assertEquals("true", evaluate(view.get(), "document.fullscreenElement?.id === 'watch'"));
            evaluate(view.get(), "document.querySelector('#player').remove(); true");
            assertEquals("true", evaluate(view.get(), "document.fullscreenElement?.id === 'watch'"));
            onMain(() -> view.get().evaluateJavascript("document.exitFullscreen()", null));
        }
    }

    private static void waitForPlayback(SubscriptionRefreshWebView view) throws Exception {
        long deadline = android.os.SystemClock.uptimeMillis() + 10000;
        while (android.os.SystemClock.uptimeMillis() < deadline) {
            String time = evaluate(view, "document.querySelector('video')?.currentTime || 0");
            if (Double.parseDouble(time) > 0.25) return;
            Thread.sleep(100);
        }
        throw new AssertionError("test video did not start in WebView");
    }

    private static void assertVisibility(SubscriptionRefreshWebView view, String expected) throws Exception {
        assertEquals("\"" + expected + "\"", evaluate(view, "document.visibilityState"));
    }

    private static String evaluate(SubscriptionRefreshWebView view, String script) throws Exception {
        AtomicReference<String> actual = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        onMain(() -> view.evaluateJavascript(script, result -> {
            actual.set(result);
            evaluated.countDown();
        }));
        assertTrue("page responds", evaluated.await(5, TimeUnit.SECONDS));
        return actual.get();
    }

    private static void onMain(Runnable action) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(action);
    }
}
