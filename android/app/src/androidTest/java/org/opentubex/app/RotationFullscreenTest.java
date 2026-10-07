package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.UiAutomation;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.os.ParcelFileDescriptor;
import android.webkit.WebView;
import android.view.WindowManager;
import android.view.OrientationEventListener;
import android.view.Surface;

import androidx.test.core.app.ActivityScenario;
import androidx.lifecycle.Lifecycle;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class RotationFullscreenTest {
    @Test
    public void fullscreenKeepsTheSystemRotationAnimation() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> assertEquals(
                "Fullscreen must preserve Android's rotating transition",
                WindowManager.LayoutParams.ROTATION_ANIMATION_ROTATE,
                activity.getWindow().getAttributes().rotationAnimation));
        }
    }

    @Test
    public void rotationRequestKeepsTheOldFrameUntilConfigurationArrives() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            CountDownLatch painted = new CountDownLatch(1);
            AtomicReference<WebViewRotationFrame> guard = new AtomicReference<>();
            scenario.onActivity(activity -> {
                WebView webView = activity.getBridge().getWebView();
                guard.set(new WebViewRotationFrame(webView, true));
                assertFalse(guard.get().onPreDraw());
                webView.postVisualStateCallback(0, new WebView.VisualStateCallback() {
                    @Override public void onComplete(long requestId) {
                        // Rendering the old portrait viewport must not release
                        // the snapshot guard before the configuration changes.
                        assertFalse(guard.get().onPreDraw());
                        guard.get().run();
                        assertTrue(guard.get().onPreDraw());
                        painted.countDown();
                    }
                });
            });
            assertTrue("Chromium must acknowledge the pending frame", painted.await(5, TimeUnit.SECONDS));
            scenario.onActivity(activity -> guard.get().run());
        }
    }

    @Test
    public void unsupportedOrientationSensorsAreRejectedAndStayDisabledOnResume() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            Field listenerField = AndroidUiPlugin.class.getDeclaredField("deviceRotationListener");
            Field enabledField = AndroidUiPlugin.class.getDeclaredField("deviceRotationEnabled");
            listenerField.setAccessible(true);
            enabledField.setAccessible(true);
            scenario.onActivity(activity -> {
                AndroidUiPlugin plugin = (AndroidUiPlugin) activity.getBridge().getPlugin("AndroidUi").getInstance();
                boolean[] enabled = { false };
                boolean[] rejected = { false };
                OrientationEventListener unsupported = new OrientationEventListener(activity) {
                    @Override public boolean canDetectOrientation() { return false; }
                    @Override public void enable() { enabled[0] = true; }
                    @Override public void onOrientationChanged(int orientation) { }
                };
                try {
                    listenerField.set(plugin, unsupported);
                    plugin.setDeviceRotationEnabled(new com.getcapacitor.PluginCall(null, "AndroidUi", "test",
                        "setDeviceRotationEnabled", new com.getcapacitor.JSObject().put("enabled", true)) {
                        @Override public void resolve() { }
                        @Override public void reject(String message) { rejected[0] = true; }
                    });
                    assertTrue("Unsupported sensors must reject the bridge call", rejected[0]);
                    assertFalse("Unsupported sensors must not stay enabled", enabledField.getBoolean(plugin));
                    plugin.handleOnResume();
                    assertFalse("Unsupported sensors must not be enabled on resume", enabled[0]);
                } catch (IllegalAccessException error) {
                    throw new AssertionError(error);
                } finally {
                    unsupported.disable();
                }
            });
        }
    }

    @Test
    public void physicalRotationRechecksTheCurrentDisplayOrientationBasis() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            Field listenerField = AndroidUiPlugin.class.getDeclaredField("deviceRotationListener");
            Field landscapeField = AndroidUiPlugin.class.getDeclaredField("deviceLandscape");
            listenerField.setAccessible(true);
            landscapeField.setAccessible(true);
            scenario.onActivity(activity -> {
                AndroidUiPlugin plugin = (AndroidUiPlugin) activity.getBridge().getPlugin("AndroidUi").getInstance();
                Configuration configuration = activity.getResources().getConfiguration();
                int originalOrientation = configuration.orientation;
                try {
                    int rotation = activity.getWindowManager().getDefaultDisplay().getRotation();
                    configuration.orientation = rotation == Surface.ROTATION_90 || rotation == Surface.ROTATION_270
                        ? Configuration.ORIENTATION_LANDSCAPE : Configuration.ORIENTATION_PORTRAIT;
                    plugin.setDeviceRotationEnabled(new com.getcapacitor.PluginCall(null, "AndroidUi", "test",
                        "setDeviceRotationEnabled", new com.getcapacitor.JSObject().put("enabled", true)) {
                        @Override public void resolve() { }
                    });
                    OrientationEventListener listener = (OrientationEventListener) listenerField.get(plugin);
                    listener.onOrientationChanged(90);
                    assertEquals(Boolean.TRUE, landscapeField.get(plugin));
                    // Simulate switching to a display with the opposite natural basis.
                    configuration.orientation = configuration.orientation == Configuration.ORIENTATION_PORTRAIT
                        ? Configuration.ORIENTATION_LANDSCAPE : Configuration.ORIENTATION_PORTRAIT;
                    listener.onOrientationChanged(90);
                    assertEquals("The same sensor angle must use the updated display basis",
                        Boolean.FALSE, landscapeField.get(plugin));
                } catch (IllegalAccessException error) {
                    throw new AssertionError(error);
                } finally {
                    configuration.orientation = originalOrientation;
                    plugin.handleOnPause();
                }
            });
        }
    }

    @Test
    public void manualDisplayRotationEntersFullscreenWithoutOverridingTheSystemLock() throws Exception {
        verifyRotationFullscreen(false);
    }

    @Test
    public void physicalRotationCanOverrideTheSystemLockWhenEnabled() throws Exception {
        org.junit.Assume.assumeTrue("Requires the emulator accelerometer host driver",
            "true".equals(InstrumentationRegistry.getArguments().getString("physicalRotationTest")));
        // The host turns the device sideways after the physical-inline marker,
        // then upright while backgrounded after the physical-fullscreen marker.
        verifyRotationFullscreen(true);
    }

    private void verifyRotationFullscreen(boolean physicalRotation) throws Exception {
        String media;
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext()
            .getAssets().open("demo.webm")) {
            media = android.util.Base64.encodeToString(YtDlpFiles.read(input, 1024 * 1024), android.util.Base64.NO_WRAP);
        }
        String autoRotate = shell("settings get system accelerometer_rotation");
        String userRotation = shell("settings get system user_rotation");
        int originalRotation = InstrumentationRegistry.getInstrumentation().getTargetContext()
            .getSystemService(WindowManager.class).getDefaultDisplay().getRotation();
        try {
            shell("settings put system accelerometer_rotation 0");
            assertTrue(InstrumentationRegistry.getInstrumentation().getUiAutomation().setRotation(UiAutomation.ROTATION_FREEZE_0));
            if (physicalRotation) {
                // UiAutomation unfreeze enables system auto-rotate as a side effect.
                // Release its forced display rotation, then restore the portrait lock.
                assertTrue(InstrumentationRegistry.getInstrumentation().getUiAutomation().setRotation(UiAutomation.ROTATION_UNFREEZE));
                shell("settings put system accelerometer_rotation 0");
                shell("settings put system user_rotation 0");
            }
            try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
                AtomicReference<WebView> reference = new AtomicReference<>();
                scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
                WebView view = reference.get();
                awaitCondition(view, "!!document.querySelector('.tabContent[aria-hidden=\"false\"]') && !!document.querySelector('.profileTrigger')");
                evaluate(view, """
                    (() => {
                        const app = document.querySelector('#app').__vue_app__.config.globalProperties;
                        const values = { EnterFullscreenOnDisplayRotate: true, FullscreenRotationIgnoresSystemLock: false,
                            VideoPlaybackEngine: 'built-in',
                            AutoplayVideos: false, UseSponsorBlock: false, UseReturnYouTubeDislikes: false,
                            UiScale: 100, CapacitorLayoutMode: 'phone', ScrollMiniPlayerEnabled: true };
                        window.__rotationSettings = Object.fromEntries(Object.keys(values).map(
                            key => [key, structuredClone(app.$store.getters['get' + key])]
                        ));
                        for (const [key, value] of Object.entries(values)) app.$store.commit('set' + key, value);
                        window.__rotationFetch = window.fetch;
                        window.fetch = (url, options) => String(url).startsWith('https://localhost/')
                            ? window.__rotationFetch(url, options) : Promise.reject(new Error('Offline rotation test'));
                        const style = document.createElement('style');
                        style.id = 'rotation-test-style';
                        style.textContent = '.tutorialOverlay { display: none !important; }';
                        document.head.append(style);
                        const root = document.querySelector('#app').__vue_app__._container._vnode.component;
                        const routerKey = Object.getOwnPropertySymbols(root.provides).find(key =>
                            typeof root.provides[key]?.push === 'function' && typeof root.provides[key]?.resolve === 'function');
                        window.__rotationRouter = root.provides[routerKey];
                        window.__rotationRouter.push('/watch/jNQXAC9IVRw');
                        window.__rotationWatch = () => {
                            const find = vnode => {
                                if (vnode?.component?.type?.name === 'Watch') return vnode.component.proxy;
                                const subtree = vnode?.component?.subTree;
                                if (subtree) { const match = find(subtree); if (match) return match; }
                                for (const child of Array.isArray(vnode?.children) ? vnode.children : []) {
                                    const match = find(child); if (match) return match;
                                }
                            };
                            return find(document.querySelector('#app').__vue_app__._container._vnode);
                        };
                    })()
                    """);
                try {
                    assertEquals("Fixture setup", "\"function\"", evaluate(view, "typeof window.__rotationWatch"));
                    awaitCondition(view, "!!window.__rotationWatch() && window.__rotationWatch().preparingVideoLoadGeneration === null");
                    evaluate(view, """
                        (() => {
                            const watch = window.__rotationWatch();
                            watch.videoLoadGeneration++;
                            Object.assign(watch, { isLoading: false, ytDlpStreamsPending: false, errorMessage: null,
                                isUpcoming: false, isLive: false, localFilePlayback: true, activeFormat: 'legacy',
                                videoTitle: 'Rotation test', videoLengthSeconds: 60,
                                legacyFormats: [{ itag: 0, qualityLabel: 'Test', mimeType: 'video/webm',
                                    width: 320, height: 180, bitrate: 0, localFile: true, url: 'data:video/webm;base64,MEDIA' }] });
                        })()
                        """.replace("MEDIA", media));
                    awaitCondition(view, "document.querySelector('.ftVideoPlayer video')?.readyState >= 2");
                    assertInlinePortrait(scenario, view);

                    // Android's rotation suggestion button changes the user-selected
                    // display rotation while accelerometer rotation remains disabled.
                    if (physicalRotation) {
                        android.util.Log.i("OpenTubeXRotationTest", "physical-inline");
                        long deadline = android.os.SystemClock.uptimeMillis() + 15000;
                        while (!shell("logcat -d -s OpenTubeXRotationTest:I '*:S'").contains("physical-landscape-ready")) {
                            assertTrue("Host turns the device sideways", android.os.SystemClock.uptimeMillis() < deadline);
                            Thread.sleep(100);
                        }
                        assertInlinePortrait(scenario, view);
                        evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setFullscreenRotationIgnoresSystemLock', true)");
                    } else {
                        assertTrue(InstrumentationRegistry.getInstrumentation().getUiAutomation().setRotation(UiAutomation.ROTATION_FREEZE_90));
                    }
                    awaitCondition(view, "innerWidth > innerHeight");
                    awaitCondition(view, "!!document.querySelector('.videoLayout:popover-open .ftVideoPlayer.fullWindow')");
                    awaitPageScrollbarEnabled(scenario, view, false);
                    awaitCondition(view, "(() => { const rect = document.querySelector('.ftVideoPlayer').getBoundingClientRect(); return rect.width >= innerWidth - 2 && rect.height >= innerHeight - 2; })()");
                    scenario.onActivity(activity -> assertEquals("Only the explicit opt-in may force landscape",
                        physicalRotation, activity.getRequestedOrientation() == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE));
                    assertEquals("0", shell("settings get system accelerometer_rotation"));
                    if (physicalRotation) {
                        scenario.moveToState(Lifecycle.State.CREATED);
                        android.util.Log.i("OpenTubeXRotationTest", "physical-fullscreen");
                        // Let the host turn the device upright while sensing is paused.
                        Thread.sleep(1000);
                        scenario.moveToState(Lifecycle.State.RESUMED);
                    } else {
                        assertTrue(InstrumentationRegistry.getInstrumentation().getUiAutomation().setRotation(UiAutomation.ROTATION_FREEZE_0));
                    }
                    awaitCondition(view, "!document.body.classList.contains('playerFullWindow')");
                    awaitPageScrollbarEnabled(scenario, view, true);
                    assertInlinePortrait(scenario, view);
                    if (physicalRotation) {
                        scenario.onActivity(activity -> assertEquals("Restore the user's orientation policy",
                            ActivityInfo.SCREEN_ORIENTATION_USER, activity.getRequestedOrientation()));
                    }
                } finally {
                    scenario.onActivity(activity -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_USER));
                    evaluate(view, """
                        (() => {
                            const app = document.querySelector('#app').__vue_app__.config.globalProperties;
                            for (const [key, value] of Object.entries(window.__rotationSettings ?? {})) app.$store.commit('set' + key, value);
                            window.fetch = window.__rotationFetch;
                            document.querySelector('#rotation-test-style')?.remove();
                            window.__rotationRouter.push('/history');
                            delete window.__rotationSettings;
                            delete window.__rotationFetch;
                            delete window.__rotationWatch;
                            delete window.__rotationRouter;
                        })()
                        """);
                }
            }
        } finally {
            try {
                InstrumentationRegistry.getInstrumentation().getUiAutomation().setRotation(
                    "1".equals(autoRotate) ? UiAutomation.ROTATION_UNFREEZE : originalRotation);
            } finally {
                try {
                    restoreSetting("user_rotation", userRotation);
                } finally {
                    restoreSetting("accelerometer_rotation", autoRotate);
                }
            }
        }
    }

    private static void awaitPageScrollbarEnabled(ActivityScenario<MainActivity> scenario, WebView view,
        boolean enabled) throws Exception {
        // The DOM update precedes the bridge worker and its native UI-thread
        // update. Main-looper idleness alone does not drain the bridge queue.
        AtomicReference<Boolean> actual = new AtomicReference<>();
        long deadline = android.os.SystemClock.uptimeMillis() + 5000;
        do {
            scenario.onActivity(activity -> actual.set(view.isVerticalScrollBarEnabled()));
            if (actual.get() == enabled) return;
            Thread.sleep(100);
        } while (android.os.SystemClock.uptimeMillis() < deadline);
        assertEquals("Native page scrollbar follows fullscreen state", Boolean.valueOf(enabled), actual.get());
    }

    private static String shell(String command) throws Exception {
        try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(
            InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command))) {
            return new String(YtDlpFiles.read(input, 4096), StandardCharsets.UTF_8).trim();
        }
    }

    private static void restoreSetting(String name, String value) throws Exception {
        shell("settings " + ("null".equals(value) ? "delete system " + name : "put system " + name + " " + value));
    }

    private static void assertInlinePortrait(ActivityScenario<MainActivity> scenario, WebView view) throws Exception {
        assertEquals("Inline playback must not open fullscreen", "false",
            evaluate(view, "!!document.querySelector('.videoLayout:popover-open')"));
        scenario.onActivity(activity -> {
            assertFalse("Inline playback must not force landscape",
                activity.getRequestedOrientation() == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        });
        awaitCondition(view, "innerHeight > innerWidth");
        scenario.onActivity(activity -> assertEquals(Configuration.ORIENTATION_PORTRAIT,
            activity.getResources().getConfiguration().orientation));
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        assertTrue("JavaScript responds", evaluated.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private static void awaitCondition(WebView view, String script) throws Exception {
        long deadline = android.os.SystemClock.uptimeMillis() + 15000;
        while (android.os.SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(view, script))) return;
            Thread.sleep(100);
        }
        assertEquals(script + " (state: " + evaluate(view, "JSON.stringify({ route: location.hash, scroll: scrollY, height: document.scrollingElement.scrollHeight, player: document.querySelector('.ftVideoPlayer')?.getBoundingClientRect().toJSON(), state: (()=>{ const state = window.__rotationWatch?.()?.$refs.player?.$?.setupState; return state && { mini: state.scrollMiniPlayerActive, fullWindow: state.fullWindowEnabled, fullscreen: state.isFullscreen, active: state.isActiveTab }; })() })") + ")",
            "true", evaluate(view, script));
    }
}
