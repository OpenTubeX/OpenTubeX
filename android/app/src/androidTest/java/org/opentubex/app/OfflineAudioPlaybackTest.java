package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.webkit.WebView;
import android.os.ParcelFileDescriptor;
import android.os.PowerManager;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;

public class OfflineAudioPlaybackTest {
    @Test public void downloadedMp3KeepsItsAudioContextAcrossActivityTransitions() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        var context = instrumentation.getTargetContext();
        File media = new File(context.getCacheDir(), "offline-audio-regression.mp3");
        try (var input = instrumentation.getContext().getAssets().open("demo-audio.mp3")) {
            Files.copy(input, media.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> {
                reference.set(activity.getBridge().getWebView());
                reference.get().getSettings().setMediaPlaybackRequiresUserGesture(false);
            });
            WebView view = reference.get();
            await(view, "!!document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store && !!document.querySelector('.topNav')");
            evaluate(view, String.format("""
                (() => {
                    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                    window.__offlineAudioSaved = {
                        MusicVisualizer: store.getters.getMusicVisualizer,
                        ContinuePlaybackWhenScreenIsLocked: store.getters.getContinuePlaybackWhenScreenIsLocked,
                        AutoplayVideos: store.getters.getAutoplayVideos,
                        ReducedMotion: store.getters.getReducedMotion,
                    };
                    store.commit('setMusicVisualizer', true);
                    store.commit('setContinuePlaybackWhenScreenIsLocked', true);
                    store.commit('setAutoplayVideos', true);
                    store.commit('setReducedMotion', 'off');
                    window.__offlineAudioContexts = [];
                    const OriginalAudioContext = window.AudioContext;
                    window.__offlineAudioOriginalContext = OriginalAudioContext;
                    window.AudioContext = class extends OriginalAudioContext {
                        constructor(...args) {
                            super(...args);
                            window.__offlineAudioContexts.push(this);
                        }
                    };
                    store.commit('upsertYtDlpDownload', {
                        id: 943943, videoId: 'offline943a', status: 'completed', mode: 'audio',
                        title: 'Offline MP3 regression',
                        files: [{videoId: 'offline943a', path: %s, extension: 'mp3', duration: 4}],
                    });
                    document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({
                        path: '/watch/offline943a', query: {downloadId: '943943'},
                    });
                })()
                """, JSONObject.quote(media.getAbsolutePath())));
            try {
                await(view, "!!document.querySelector('video')");
                evaluate(view, """
                    window.__offlineAudioProgress = 0;
                    document.querySelector('video').addEventListener('timeupdate', () => window.__offlineAudioProgress++);
                    document.querySelector('video').loop = true;
                    document.querySelector('video').play(); true
                    """);
                await(view, "document.querySelector('video').currentTime > 0.25 && window.__offlineAudioContexts.length > 0");
                assertEquals("\"running\"", evaluate(view, "window.__offlineAudioContexts[0].state"));
                for (int cycle = 0; cycle < 3; cycle++) {
                    int before = Integer.parseInt(evaluate(view, "window.__offlineAudioProgress"));
                    scenario.moveToState(Lifecycle.State.CREATED);
                    Thread.sleep(1000);
                    assertEquals("Visualizer must not suspend audio during background playback",
                        "\"running\"", evaluate(view, "window.__offlineAudioContexts[0].state"));
                    assertEquals("false", evaluate(view, "document.querySelector('video').paused"));
                    assertTrue("Playback advances while the activity is hidden",
                        Integer.parseInt(evaluate(view, "window.__offlineAudioProgress")) > before + 1);
                    scenario.moveToState(Lifecycle.State.RESUMED);
                    Thread.sleep(1000);
                    assertEquals("\"running\"", evaluate(view, "window.__offlineAudioContexts[0].state"));
                }
                shell("input keyevent KEYCODE_SLEEP");
                Thread.sleep(1000);
                assertTrue("Screen is locked", !context.getSystemService(PowerManager.class).isInteractive());
                assertEquals("Visualizer keeps its audio graph running behind the lock screen",
                    "\"running\"", evaluate(view, "window.__offlineAudioContexts[0].state"));
                assertEquals("false", evaluate(view, "document.querySelector('video').paused"));
                shell("input keyevent KEYCODE_WAKEUP");
                shell("wm dismiss-keyguard");
                scenario.moveToState(Lifecycle.State.RESUMED);
                await(view, "window.__offlineAudioContexts[0].state === 'running'");
            } finally {
                shell("input keyevent KEYCODE_WAKEUP");
                shell("wm dismiss-keyguard");
                scenario.moveToState(Lifecycle.State.RESUMED);
                evaluate(view, """
                    (() => {
                        document.querySelector('video')?.pause();
                        const app = document.querySelector('#app').__vue_app__.config.globalProperties;
                        app.$router.push('/subscriptions');
                        app.$store.commit('removeYtDlpDownload', 943943);
                        for (const [key, value] of Object.entries(window.__offlineAudioSaved)) app.$store.commit('set' + key, value);
                        window.AudioContext = window.__offlineAudioOriginalContext;
                    })()
                    """);
            }
        } finally {
            media.delete();
        }
    }

    private static void shell(String command) throws Exception {
        try (var input = new ParcelFileDescriptor.AutoCloseInputStream(
            InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command))) {
            while (input.read() != -1) {}
        }
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            done.countDown();
        }));
        assertTrue("WebView responds", done.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private static void await(WebView view, String condition) throws Exception {
        long deadline = android.os.SystemClock.uptimeMillis() + 30000;
        while (android.os.SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(view, condition))) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Offline audio condition failed: " + condition + "; " + evaluate(view,
            "JSON.stringify({text:document.body.innerText.slice(-1000),time:document.querySelector('video')?.currentTime,error:document.querySelector('video')?.error?.message,contexts:window.__offlineAudioContexts?.map(c => c.state)})"));
    }
}
