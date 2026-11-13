package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.os.Build;
import android.content.pm.ActivityInfo;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.webkit.WebView;

import androidx.activity.BackEventCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PredictiveBackTest {
    private static final String STORE = "document.querySelector('#app').__vue_app__.config.globalProperties.$store";
    private int drawerOriginalOrientation;

    @Before
    public void grantNotifications() {
        // Opening Subscriptions refreshes the feed, which asks for notification
        // permission. Its dialog would cover the app and take the edge swipes.
        if (Build.VERSION.SDK_INT >= 33) {
            InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(
                InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName(),
                android.Manifest.permission.POST_NOTIFICATIONS);
        }
    }

    @Test
    public void settingsBackDismissalNeverReappears() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = ready(scenario);
            evaluate(view, """
                (() => {
                    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                    const keys = ['UiScale', 'CapacitorLayoutMode', 'ReducedMotion'];
                    window.__dismissSettings = Object.fromEntries(keys.map(key => [key, store.getters['get' + key]]));
                    store.dispatch('updateReducedMotion', 'off');
                    window.__dismissHistory = store.getters.getActiveTab.historyIndex;
                })()
                """);
            try {
                for (int scale : new int[] { 85, 100 }) {
                    evaluate(view, STORE + ".commit('setUiScale', " + scale + ")");
                    for (String layout : new String[] { "phone", "tablet" }) {
                        evaluate(view, STORE + ".commit('setCapacitorLayoutMode', '" + layout + "')");
                        for (boolean predictive : new boolean[] { false, true }) {
                            if (predictive && Build.VERSION.SDK_INT < 34) continue;
                            evaluate(view, STORE + ".dispatch('showSettingsWindow')");
                            await(view, "!!document.querySelector('.settingsWindow')");
                            evaluate(view, "document.querySelector('.settingsBackButton')?.click()");
                            await(view, "!document.querySelector('.settingsWindow[data-android-back-nested]')");
                            Thread.sleep(300);
                            if (predictive) {
                                start(BackEventCompat.EDGE_LEFT);
                                progress(0.65f, BackEventCompat.EDGE_LEFT);
                                await(view, "document.querySelector('.settingsWindow').getAnimations().some(a => a.playState === 'paused')");
                            }
                            evaluate(view, """
                                (() => {
                                    const element = document.querySelector('.settingsWindow');
                                    window.__dismissOpacities = [Number(getComputedStyle(element).opacity)];
                                    const sample = () => {
                                        if (!element.isConnected) return;
                                        window.__dismissOpacities.push(Number(getComputedStyle(element).opacity));
                                        requestAnimationFrame(sample);
                                    };
                                    requestAnimationFrame(sample);
                                })()
                                """);
                            onMain(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                            await(view, "!document.querySelector('.settingsWindow')");
                            assertEquals("Settings must fade out without reappearing: " + layout + ", scale " + scale +
                                ", predictive " + predictive + ", samples " + evaluate(view, "JSON.stringify(window.__dismissOpacities)"),
                                "true", evaluate(view, "window.__dismissOpacities.every((opacity, i, values) => !i || opacity <= values[i - 1] + 0.03)"));
                            assertEquals("Dismissal preserves page history", "true", evaluate(view,
                                STORE + ".getters.getActiveTab.historyIndex === window.__dismissHistory"));
                        }
                    }
                }
            } finally {
                evaluate(view, STORE + ".dispatch('hideSettingsWindow');" +
                    "for (const [key, value] of Object.entries(window.__dismissSettings)) " + STORE + ".commit('set' + key, value);" +
                    STORE + ".dispatch('updateReducedMotion', window.__dismissSettings.ReducedMotion); delete window.__dismissSettings");
            }
        }
    }

    @Test
    public void utilityWindowsAndPromptsFollowBackWithoutChangingPageHistory() throws Exception {
        assumeTrue(Build.VERSION.SDK_INT >= 34);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = ready(scenario);
            evaluate(view, """
                (() => {
                    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                    const keys = ['UiScale', 'CapacitorLayoutMode', 'ReducedMotion', 'ConfirmCloseApp'];
                    window.__modalSettings = Object.fromEntries(keys.map(key => [key, store.getters['get' + key]]));
                    store.commit('setUiScale', 85);
                    store.dispatch('updateReducedMotion', 'off');
                    window.__modalEntry = store.getters.getActiveTab.historyIndex;
                })()
                """);
            try {
                for (String layout : new String[] { "phone", "tablet" }) {
                    evaluate(view, STORE + ".commit('setCapacitorLayoutMode', '" + layout + "')");
                    for (String utility : new String[] { "null", "'about'", "'downloads'" }) {
                        evaluate(view, STORE + ".dispatch('showSettingsWindow', " + utility + ")");
                        await(view, "!!document.querySelector('.settingsWindow')");
                        evaluate(view, "document.querySelector('.settingsBackButton')?.click()");
                        await(view, "!document.querySelector('.settingsWindow[data-android-back-nested]')");
                        Thread.sleep(300);
                        verifyDialogGesture(view, ".settingsWindow", true);
                    }
                }

                // A phone category returns to the settings menu, preserving its window.
                evaluate(view, STORE + ".commit('setCapacitorLayoutMode', 'phone');" + STORE + ".dispatch('showSettingsWindow')");
                await(view, "!!document.querySelector('.settingsWindow')");
                evaluate(view, "document.querySelector('.settingsBackButton')?.click()");
                await(view, "!document.querySelector('.settingsWindow[data-android-back-nested]')");
                evaluate(view, "document.querySelector('.settingsMenu [data-section=\"appearance\"]').click()");
                await(view, "!!document.querySelector('.settingsWindow[data-android-back-nested]')");
                Thread.sleep(300);
                verifyDialogGesture(view, ".settingsContent", false);
                await(view, "!document.querySelector('.settingsWindow[data-android-back-nested]') && " + STORE + ".getters.getSettingsWindowOpen");
                evaluate(view, "document.querySelector('.settingsMenu [data-section=\"appearance\"]').click()");
                await(view, "!!document.querySelector('.settingsWindow[data-android-back-nested]')");
                Thread.sleep(300);
                start(BackEventCompat.EDGE_LEFT);
                progress(0.5f, BackEventCompat.EDGE_LEFT);
                await(view, "document.querySelector('.settingsContent').getAnimations().some(a => a.playState === 'paused')");
                onMain(activity -> {
                    activity.getOnBackPressedDispatcher().onBackPressed();
                    activity.getOnBackPressedDispatcher().onBackPressed();
                });
                await(view, "!document.querySelector('.settingsWindow')");
                assertEquals("Two rapid Back presses return from the category then close Settings", "true",
                    evaluate(view, STORE + ".getters.getActiveTab.historyIndex === window.__modalEntry"));
                evaluate(view, STORE + ".dispatch('hideSettingsWindow');" + STORE + ".commit('setConfirmCloseApp', true)");
                await(view, "!document.querySelector('.settingsWindow')");
                Thread.sleep(200);
                onMain(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                await(view, "!!document.querySelector('.prompt')");
                Thread.sleep(300);
                verifyDialogGesture(view, ".prompt", true);

                evaluate(view, STORE + ".dispatch('updateReducedMotion', 'on');" + STORE + ".dispatch('showSettingsWindow', 'about')");
                await(view, "!!document.querySelector('.settingsWindow') && document.documentElement.dataset.reducedMotion === 'reduce'");
                start(BackEventCompat.EDGE_LEFT);
                progress(0.5f, BackEventCompat.EDGE_LEFT);
                assertEquals("Reduced motion uses ordinary modal Back", "false", evaluate(view,
                    "document.querySelector('.settingsWindow').getAnimations().some(a => a.playState === 'paused')"));
                onMain(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                await(view, "!" + STORE + ".getters.getSettingsWindowOpen");
            } finally {
                evaluate(view, STORE + ".dispatch('hideKeyboardShortcutPrompt');" + STORE + ".dispatch('hideSettingsWindow');" +
                    "for (const [key, value] of Object.entries(window.__modalSettings)) " + STORE + ".commit('set' + key, value);" +
                    STORE + ".dispatch('updateReducedMotion', window.__modalSettings.ReducedMotion); delete window.__modalSettings");
                Thread.sleep(300);
            }
        }
    }

    private static void verifyDialogGesture(WebView view, String selector, boolean closes) throws Exception {
        evaluate(view, "window.__modalElement = document.querySelector('" + selector + "');" +
            "window.__modalScrollTop = window.__modalElement.scrollTop");
        start(BackEventCompat.EDGE_LEFT);
        progress(0.6f, BackEventCompat.EDGE_LEFT);
        await(view, "window.__modalElement.getAnimations().some(a => a.playState === 'paused' && a.currentTime > 0)");
        assertEquals("Progress keeps the view open and page history unchanged", "true", evaluate(view,
            "window.__modalElement.isConnected && " + STORE + ".getters.getActiveTab.historyIndex === window.__modalEntry"));
        onMain(activity -> activity.getOnBackPressedDispatcher().dispatchOnBackCancelled());
        await(view, "window.__modalElement.getAnimations().length === 0");
        assertEquals("Cancel restores opacity and reading position", "true", evaluate(view,
            "window.__modalElement.isConnected && Number(getComputedStyle(window.__modalElement).opacity) === 1 && " +
            "window.__modalElement.scrollTop === window.__modalScrollTop"));
        // Move all the way back to the edge before lifting the finger.
        start(BackEventCompat.EDGE_LEFT);
        progress(0.6f, BackEventCompat.EDGE_LEFT);
        await(view, "window.__modalElement.getAnimations().some(a => a.playState === 'paused' && a.currentTime > 0)");
        progress(0f, BackEventCompat.EDGE_LEFT);
        await(view, "window.__modalElement.getAnimations().some(a => a.playState === 'paused' && a.currentTime === 0)");
        evaluate(view, """
            (() => {
                const element = window.__modalElement;
                window.__cancelFlickered = false;
                window.__cancelSampling = true;
                const sample = () => {
                    if (!window.__cancelSampling) return;
                    if (Number(getComputedStyle(element).opacity) < 0.97) window.__cancelFlickered = true;
                    requestAnimationFrame(sample);
                };
                requestAnimationFrame(sample);
            })()
            """);
        onMain(activity -> activity.getOnBackPressedDispatcher().dispatchOnBackCancelled());
        await(view, "window.__modalElement.getAnimations().length === 0");
        evaluate(view, "window.__cancelSampling = false");
        assertEquals("Cancel at the starting edge must not replay the preview", "false", evaluate(view, "window.__cancelFlickered"));
        Thread.sleep(100);
        start(BackEventCompat.EDGE_RIGHT);
        progress(0.65f, BackEventCompat.EDGE_RIGHT);
        await(view, "window.__modalElement.getAnimations().some(a => a.playState === 'paused')");
        if (closes) evaluate(view, """
            (() => {
                const element = window.__modalElement;
                let previousOpacity = Number(getComputedStyle(element).opacity);
                window.__modalFlickered = false;
                const sample = () => {
                    if (!element.isConnected) return;
                    const opacity = Number(getComputedStyle(element).opacity);
                    if (opacity > previousOpacity + 0.03) window.__modalFlickered = true;
                    previousOpacity = opacity;
                    requestAnimationFrame(sample);
                };
                requestAnimationFrame(sample);
            })()
            """);
        onMain(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
        if (closes) await(view, "!window.__modalElement.isConnected");
        else await(view, "!window.__modalElement.getAnimations().some(a => a.playState === 'paused')");
        if (closes) assertEquals("A dismissed modal must never become visible again before removal", "false",
            evaluate(view, "window.__modalFlickered"));
        assertEquals("Commit never navigates the page behind the dialog", "true", evaluate(view,
            STORE + ".getters.getActiveTab.historyIndex === window.__modalEntry"));
    }

    @Test
    public void playerFollowsProgressCancelsAndDocksWithoutReloadingPlayback() throws Exception {
        assumeTrue(Build.VERSION.SDK_INT >= 34);
        String media;
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("demo.webm")) {
            media = android.util.Base64.encodeToString(YtDlpFiles.read(input, 1024 * 1024), android.util.Base64.NO_WRAP);
        }
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = ready(scenario);
            evaluate(view, """
                (() => {
                    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                    const values = { KeepPlayingOnNavigation: true, VideoPlaybackEngine: 'built-in',
                        AutoplayVideos: false, UseSponsorBlock: false, UseReturnYouTubeDislikes: false,
                        UiScale: 85, CapacitorLayoutMode: 'phone', ReducedMotion: 'off',
                        ScrollMiniPlayerEnabled: true, EnterFullscreenOnDisplayRotate: false };
                    window.__backSettings = Object.fromEntries(Object.keys(values).map(
                        key => [key, structuredClone(store.getters['get' + key])]
                    ));
                    for (const [key, value] of Object.entries(values)) store.commit('set' + key, value);
                    store.dispatch('updateReducedMotion', 'off');
                    window.__backFetch = window.fetch;
                    window.fetch = (url, options) => String(url).startsWith('https://localhost/')
                        ? window.__backFetch(url, options) : Promise.reject(new Error('Offline predictive back test'));
                    const root = document.querySelector('#app').__vue_app__._container._vnode.component;
                    const routerKey = Object.getOwnPropertySymbols(root.provides).find(key =>
                        typeof root.provides[key]?.push === 'function' && typeof root.provides[key]?.resolve === 'function');
                    window.__backRouter = root.provides[routerKey];
                    window.__backRouter.push('/watch/jNQXAC9IVRw');
                    window.__backWatch = () => {
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
                await(view, "!!window.__backWatch() && window.__backWatch().preparingVideoLoadGeneration === null");
                evaluate(view, """
                    (() => {
                        const watch = window.__backWatch();
                        watch.videoLoadGeneration++;
                        Object.assign(watch, { isLoading: false, ytDlpStreamsPending: false, errorMessage: null,
                            isUpcoming: false, isLive: false, localFilePlayback: true, activeFormat: 'legacy',
                            videoTitle: 'Predictive back test', videoLengthSeconds: 60,
                            legacyFormats: [{ itag: 0, qualityLabel: 'Test', mimeType: 'video/webm',
                                width: 320, height: 180, bitrate: 0, localFile: true, url: 'data:video/webm;base64,MEDIA' }] });
                    })()
                    """.replace("MEDIA", media));
                await(view, "document.querySelector('.ftVideoPlayer video')?.readyState >= 2");
                evaluate(view, "window.__backVideo = document.querySelector('.ftVideoPlayer video');" +
                    "window.__backVideo.loop = true; window.__backVideo.play()");
                await(view, "!window.__backVideo.paused && window.__backWatch().$refs.player.hasLoaded");
                await(view, "!document.querySelector('[data-mobile-mini-morph], [data-inline-mini-drag]')");
                Thread.sleep(200);
                evaluate(view, "window.__backEntry = " + STORE + ".getters.getActiveTab.historyIndex;" +
                    "window.__backTop = document.querySelector('.ftVideoPlayer').getBoundingClientRect().top");
                start(BackEventCompat.EDGE_LEFT);
                progress(0.5f, BackEventCompat.EDGE_LEFT);
                await(view, "document.querySelector('.ftVideoPlayer').hasAttribute('data-mobile-mini-morph') && " +
                    "document.querySelector('.ftVideoPlayer').getBoundingClientRect().top > window.__backTop + 40");
                assertEquals("Holding the gesture must not navigate", "true",
                    evaluate(view, STORE + ".getters.getActiveTab.historyIndex === window.__backEntry"));
                progress(0.15f, BackEventCompat.EDGE_LEFT);
                onMain(activity -> activity.getOnBackPressedDispatcher().dispatchOnBackCancelled());
                await(view, "!document.querySelector('[data-inline-mini-drag]')");
                assertEquals("Cancellation restores the inline player and history", "true", evaluate(view,
                    STORE + ".getters.getActiveTab.historyIndex === window.__backEntry && !window.__backVideo.paused && " +
                    "Math.abs(document.querySelector('.ftVideoPlayer').getBoundingClientRect().top - window.__backTop) < 1"));

                // Higher progress, the other edge, and tablet layout share the same dock.
                evaluate(view, STORE + ".commit('setCapacitorLayoutMode', 'tablet')");
                start(BackEventCompat.EDGE_RIGHT);
                progress(0.75f, BackEventCompat.EDGE_RIGHT);
                await(view, "!!document.querySelector('[data-mobile-mini-morph]')");
                onMain(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                await(view, "!!document.querySelector('.mobileMiniBar') && !document.querySelector('[data-inline-mini-drag]')");
                assertEquals("Commit navigates exactly once and retains the playing video", "true", evaluate(view,
                    STORE + ".getters.getActiveTab.historyIndex === window.__backEntry - 1 && " +
                    "document.querySelector('.mobileMiniBar video') === window.__backVideo && !window.__backVideo.paused"));

                evaluate(view, "document.querySelector('.mobileMiniBarReturn').click()");
                await(view, "!!window.__backWatch()?.$refs.player && !document.querySelector('.mobileMiniBar, [data-inline-mini-drag]')");
                evaluate(view, STORE + ".commit('setCapacitorLayoutMode', 'phone')");
                await(view, "window.__backWatch().phonePanelsEnabled");
                verifyBottomSheets(view);

                for (boolean loading : new boolean[] { false, true }) {
                    evaluate(view, "window.__backVideo.pause(); window.__backSource = window.__backVideo.currentSrc");
                    if (loading) {
                        evaluate(view, "window.__backVideo.poster = 'data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"320\" height=\"180\"><rect width=\"320\" height=\"180\" fill=\"navy\"/></svg>';" +
                            "window.__backVideo.removeAttribute('src'); window.__backVideo.load()");
                        await(view, "window.__backVideo.readyState === 0");
                    }
                    Thread.sleep(200);
                    evaluate(view, "window.__backEntry = " + STORE + ".getters.getActiveTab.historyIndex");
                    start(BackEventCompat.EDGE_LEFT);
                    progress(0.5f, BackEventCompat.EDGE_LEFT);
                    await(view, "!!document.querySelector('[data-mobile-mini-morph]')");
                    onMain(activity -> activity.getOnBackPressedDispatcher().dispatchOnBackCancelled());
                    await(view, "!document.querySelector('[data-inline-mini-drag]')");
                    assertEquals("Cancel preserves paused/loading state", "true", evaluate(view,
                        "window.__backVideo.paused && " + STORE + ".getters.getActiveTab.historyIndex === window.__backEntry"));
                    start(BackEventCompat.EDGE_RIGHT);
                    progress(0.65f, BackEventCompat.EDGE_RIGHT);
                    await(view, "!!document.querySelector('[data-mobile-mini-morph]')");
                    onMain(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                    await(view, "!!document.querySelector('.mobileMiniBar') && !document.querySelector('[data-inline-mini-drag]')");
                    assertEquals("Commit retains the same paused/loading video", "true", evaluate(view,
                        "document.querySelector('.mobileMiniBar video') === window.__backVideo && window.__backVideo.paused && " +
                        STORE + ".getters.getActiveTab.historyIndex === window.__backEntry - 1"));
                    if (loading) assertEquals("The poster remains available", "true", evaluate(view,
                        "window.__backVideo.readyState === 0 && window.__backVideo.poster.startsWith('data:image/')"));
                    evaluate(view, "document.querySelector('.mobileMiniBarReturn').click()");
                    await(view, "!document.querySelector('.mobileMiniBar, [data-inline-mini-drag]')");
                    if (loading) evaluate(view, "window.__backVideo.src = window.__backSource");
                }
                await(view, "window.__backVideo.readyState >= 2");
                evaluate(view, "window.__backVideo.play()");
                await(view, "!window.__backVideo.paused");
                evaluate(view, STORE + ".dispatch('updateReducedMotion', 'on')");
                await(view, "document.documentElement.dataset.reducedMotion === 'reduce'");
                start(BackEventCompat.EDGE_LEFT);
                progress(0.5f, BackEventCompat.EDGE_LEFT);
                assertEquals("Reduced motion does not morph the player", "false",
                    evaluate(view, "!!document.querySelector('[data-mobile-mini-morph]')"));
                onMain(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                await(view, "!!document.querySelector('.mobileMiniBar')");
                assertEquals("Reduced motion keeps the normal Back action", "false", evaluate(view, "window.__backVideo.paused"));
            } finally {
                evaluate(view, "window.__backVideo?.pause();" + STORE + ".commit('setKeepPlayingOnNavigation', false);" +
                    "window.__backRouter.push('/subscriptions')");
                await(view, "!document.querySelector('.ftVideoPlayer')");
                evaluate(view, """
                    window.__backVideo?.pause();
                    for (const [key, value] of Object.entries(window.__backSettings ?? {})) {
                        document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('set' + key, value);
                    }
                    document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch(
                        'updateReducedMotion', window.__backSettings.ReducedMotion);
                    window.fetch = window.__backFetch;
                    window.__backRouter.push('/subscriptions');
                    delete window.__backSettings; delete window.__backFetch; delete window.__backWatch;
                    delete window.__backRouter; delete window.__backVideo;
                    """);
                await(view, STORE + ".getters.getActiveTab.route.path === '/subscriptions'");
                Thread.sleep(300);
            }
        }
    }

    private static void verifyBottomSheets(WebView view) throws Exception {
        for (String panel : new String[] { "comments", "description", "chapters" }) {
            evaluate(view, "window.__backWatch().openPhonePanel('" + panel + "')");
            await(view, "!!document.querySelector('.dockedSheet[open]')");
            // Record the resting position only after opening and content layout settle.
            await(view, "(() => { const sheet = document.querySelector('.dockedSheet[open]');" +
                "const top = sheet.getBoundingClientRect().top; const settled = window.__backSettlingTop === top;" +
                "window.__backSettlingTop = top; return settled && sheet.getAnimations().length === 0; })()");
            evaluate(view, "delete window.__backSettlingTop;" +
                "window.__backSheet = document.querySelector('.dockedSheet[open]');" +
                "window.__backSheetTop = window.__backSheet.getBoundingClientRect().top;" +
                "window.__backEntry = " + STORE + ".getters.getActiveTab.historyIndex;" +
                "window.__backScroll = window.__backSheet.querySelector('[data-overlayscrollbars-viewport]');" +
                "if (window.__backScroll) window.__backScroll.scrollTop = 120;" +
                "window.__backScrollTop = window.__backScroll?.scrollTop");
            start(BackEventCompat.EDGE_LEFT);
            progress(0.5f, BackEventCompat.EDGE_LEFT);
            await(view, "window.__backSheet.getAnimations().some(a => a.playState === 'paused') && " +
                "window.__backSheet.getBoundingClientRect().top > window.__backSheetTop + 40");
            assertEquals("Sheet takes priority over player navigation", "true", evaluate(view,
                STORE + ".getters.getActiveTab.historyIndex === window.__backEntry && !document.querySelector('[data-inline-mini-drag]')"));
            onMain(activity -> activity.getOnBackPressedDispatcher().dispatchOnBackCancelled());
            await(view, "window.__backSheet.getAnimations().length === 0");
            assertEquals("Cancel restores sheet and reading position", "true", evaluate(view,
                "window.__backSheet.open && Math.abs(window.__backSheet.getBoundingClientRect().top - window.__backSheetTop) < 1 && " +
                "window.__backScroll?.scrollTop === window.__backScrollTop"));
            start(BackEventCompat.EDGE_RIGHT);
            progress(0.65f, BackEventCompat.EDGE_RIGHT);
            await(view, "window.__backSheet.getAnimations().some(a => a.playState === 'paused')");
            onMain(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
            await(view, "!document.querySelector('.dockedSheet[open]') && window.__backWatch().mobilePanel === null");
            assertEquals("Commit dismisses only the sheet", "true", evaluate(view,
                STORE + ".getters.getActiveTab.historyIndex === window.__backEntry && !window.__backVideo.paused"));
        }
    }

    @Test
    public void drawerCancelsAndOrdinaryBackDismissesLayersBeforeHistory() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = ready(scenario);
            prepareDrawer(scenario, view);
            evaluate(view, "window.__drawerLocale = " + STORE + ".getters.getCurrentLocale;" +
                "window.__drawerLanguage = document.documentElement.lang; window.__backConfirm = " + STORE + ".getters.getConfirmCloseApp;" +
                STORE + ".commit('setConfirmCloseApp', false);" + STORE + ".commit('toggleSideNav')");
            try {
                await(view, "document.querySelector('.app').classList.contains('isSideNavOpen')");
                // Wait for the renderer to publish its ahead-of-time interception state.
                Thread.sleep(200);
                if (Build.VERSION.SDK_INT >= 34) {
                    start(BackEventCompat.EDGE_LEFT);
                    progress(0.5f, BackEventCompat.EDGE_LEFT);
                    await(view, "document.querySelector('.sideNav').getAnimations().some(a => a.playState === 'paused')");
                    onMain(activity -> activity.getOnBackPressedDispatcher().dispatchOnBackCancelled());
                    await(view, "document.querySelector('.sideNav').getAnimations().length === 0");
                    assertEquals("Cancel keeps the drawer open", "true", evaluate(view, STORE + ".getters.getIsSideNavOpen"));
                    for (String locale : new String[] { "en-US", "ar" }) {
                        evaluate(view, STORE + ".dispatch('updateCurrentLocale', '" + locale + "')");
                        await(view, "document.documentElement.lang === '" + locale + "'");
                        Thread.sleep(200);
                        evaluate(view, "window.__drawerOpenLeft = document.querySelector('.sideNav').getBoundingClientRect().left");
                        start(BackEventCompat.EDGE_RIGHT);
                        progress(0.65f, BackEventCompat.EDGE_RIGHT);
                        await(view, "document.querySelector('.sideNav').getAnimations().some(a => a.playState === 'paused' && a.currentTime > 0)");
                        evaluate(view, """
                            (() => {
                                const drawer = document.querySelector('.sideNav');
                                const distance = () => Math.abs(drawer.getBoundingClientRect().left - window.__drawerOpenLeft);
                                let previousDistance = distance();
                                window.__drawerCommitFlickered = false;
                                window.__drawerCommitFrames = [];
                                window.__drawerCommitSampling = true;
                                const sample = () => {
                                    if (!window.__drawerCommitSampling) return;
                                    const currentDistance = distance();
                                    window.__drawerCommitFrames.push(currentDistance);
                                    if (currentDistance < previousDistance - 0.5) window.__drawerCommitFlickered = true;
                                    previousDistance = currentDistance;
                                    requestAnimationFrame(sample);
                                };
                                requestAnimationFrame(sample);
                            })()
                            """);
                        onMain(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                        await(view, "!" + STORE + ".getters.getIsSideNavOpen && document.querySelector('.sideNav').getAnimations().length === 0");
                        evaluate(view, "window.__drawerCommitSampling = false");
                        assertEquals("Committed drawer must never move back on screen: " + evaluate(view, "window.__drawerCommitFrames"),
                            "false", evaluate(view, "window.__drawerCommitFlickered"));
                        evaluate(view, STORE + ".commit('toggleSideNav')");
                        await(view, STORE + ".getters.getIsSideNavOpen");
                        Thread.sleep(200);
                    }
                }
                onMain(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                await(view, "!" + STORE + ".getters.getIsSideNavOpen");
                evaluate(view, STORE + ".dispatch('showSettingsWindow')");
                await(view, "!!document.querySelector('.settingsWindow')");
                Thread.sleep(200);
                onMain(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                await(view, "!document.querySelector('.settingsWindow')");
            } finally {
                evaluate(view, "if (" + STORE + ".getters.getIsSideNavOpen) " + STORE + ".commit('toggleSideNav');" + STORE + ".commit('setConfirmCloseApp', window.__backConfirm)");
                evaluate(view, STORE + ".dispatch('updateCurrentLocale', window.__drawerLocale)");
                await(view, "document.documentElement.lang === window.__drawerLanguage");
                restoreDrawer(scenario, view);
            }
        }
    }

    @Test
    public void pageBackRevealsTheKeptPageAndReturnsToItWithoutReloading() throws Exception {
        assumeTrue(Build.VERSION.SDK_INT >= 34);
        String tab = ".tabContent[data-tab-id=\"' + " + STORE + ".getters.getPresentedTabId + '\"]";
        String kept = "document.querySelector('" + tab + " > .retainedPage')";
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = ready(scenario);
            evaluate(view, "window.__pageBackMotion = " + STORE + ".getters.getReducedMotion;" +
                STORE + ".dispatch('updateReducedMotion', 'off')");
            try {
                // Leave the page scrolled, so Back has to show and restore its own offset.
                // The page may still replace the landing page and restores its own
                // offset once it loads, so lengthen and scroll it until that stays.
                await(view, "document.querySelector('" + tab + " > .routerView').style.minHeight = '5000px'," +
                    "scrollTo(0, 800), Math.round(scrollY) === 800");
                evaluate(view, "scrollTo(0, 800); window.__backRouter.push('/history')");
                await(view, STORE + ".getters.getActiveTab.route.path === '/history' && !!" + kept);
                evaluate(view, "window.__keptPage = " + kept);
                Thread.sleep(200);

                slide(view, 0f, BackEventCompat.EDGE_RIGHT);
                slide(view, 0.5f, BackEventCompat.EDGE_RIGHT);
                await(view, "getComputedStyle(window.__keptPage).contentVisibility === 'visible' && " +
                    "document.querySelector('" + tab + " > .routerView:not(.retainedPage)').getAnimations().some(a => a.playState === 'paused' && a.currentTime > 0)");
                onMain(activity -> activity.getOnBackPressedDispatcher().dispatchOnBackCancelled());
                await(view, "getComputedStyle(window.__keptPage).contentVisibility === 'hidden' && " +
                    "document.querySelector('" + tab + " > .routerView:not(.retainedPage)').getAnimations().length === 0");
                assertEquals("Cancel stays on the page", "\"/history\"", evaluate(view, STORE + ".getters.getActiveTab.route.path"));

                slide(view, 0f, BackEventCompat.EDGE_LEFT);
                slide(view, 0.6f, BackEventCompat.EDGE_LEFT);
                await(view, "getComputedStyle(window.__keptPage).contentVisibility === 'visible'");
                evaluate(view, """
                    (() => {
                        // Back must leave the revealed page where the gesture showed it.
                        // Sample after each frame's callbacks, where navigation restores scroll before painting.
                        const tops = window.__keptPageTops = [window.__keptPage.getBoundingClientRect().top];
                        const sample = () => setTimeout(() => {
                            if (!window.__keptPage.isConnected) return;
                            tops.push(window.__keptPage.getBoundingClientRect().top);
                            if (tops.length < 60) requestAnimationFrame(sample);
                        });
                        requestAnimationFrame(sample);
                    })()
                    """);
                onMain(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                await(view, STORE + ".getters.getActiveTab.route.path === '/subscriptions' && !window.__keptPage.classList.contains('retainedPage')");
                assertEquals("Back shows the kept page instead of mounting a new one", "true", evaluate(view,
                    "window.__keptPage.isConnected && document.querySelectorAll('" + tab + " > .routerView').length === 1"));
                // Back restores the kept page's own scroll position.
                await(view, "Math.round(scrollY) === 800");
                Thread.sleep(500);
                assertEquals("The kept page must not move when Back commits: " + evaluate(view, "JSON.stringify(window.__keptPageTops)"),
                    "true", evaluate(view, "Math.max(...window.__keptPageTops) - Math.min(...window.__keptPageTops) < 1"));
            } finally {
                evaluate(view, STORE + ".dispatch('updateReducedMotion', window.__pageBackMotion);" +
                    "window.__keptPage?.style.removeProperty('min-height'); delete window.__keptPage");
            }
        }
    }

    @Test
    public void systemEdgeSwipeDrivesTheDrawerAndRootReleasesBackToAndroid() throws Exception {
        assumeTrue(Build.VERSION.SDK_INT >= 34);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = ready(scenario);
            prepareDrawer(scenario, view);
            evaluate(view, "window.__backConfirm = " + STORE + ".getters.getConfirmCloseApp;" +
                STORE + ".commit('setConfirmCloseApp', false);" + STORE + ".commit('toggleSideNav')");
            try {
                await(view, STORE + ".getters.getIsSideNavOpen");
                // An IME consumes the system gesture before the app, and the
                // navigation bar must finish rotating before edge injection.
                evaluate(view, "document.activeElement?.blur()");
                scenario.onActivity(activity -> {
                    android.view.inputmethod.InputMethodManager keyboard =
                        (android.view.inputmethod.InputMethodManager) activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE);
                    keyboard.hideSoftInputFromWindow(activity.getWindow().getDecorView().getWindowToken(), 0);
                });
                Thread.sleep(1000);
                int[] screen = new int[2];
                scenario.onActivity(activity -> {
                    android.graphics.Point size = new android.graphics.Point();
                    activity.getWindowManager().getDefaultDisplay().getRealSize(size);
                    screen[0] = size.x;
                    screen[1] = size.y;
                });
                int height = screen[1];
                assertTrue("Landscape physical display", screen[0] > screen[1]);
                long downTime = SystemClock.uptimeMillis();
                touch(downTime, downTime, MotionEvent.ACTION_DOWN, screen[0] - 2, height / 2f);
                // Timestamp the swipe 40ms apart even when injection stalls, since
                // the system cancels an edge swipe held too long before it moves.
                long eventTime = downTime;
                for (int x : new int[] { 30, 60, 120, 200, 320 }) {
                    Thread.sleep(40);
                    eventTime += 40;
                    touch(downTime, eventTime, MotionEvent.ACTION_MOVE, screen[0] - x, height / 2f);
                }
                await(view, "document.querySelector('.sideNav').getAnimations().some(a => a.playState === 'paused' && a.currentTime > 0)");
                touch(downTime, MotionEvent.ACTION_UP, screen[0] - 320, height / 2f);
                await(view, "!" + STORE + ".getters.getIsSideNavOpen");

                // A fresh tab has no app history. No callback may consume the
                // system's back-to-home preview when confirmation is disabled.
                evaluate(view, "document.querySelector('.capacitorTabletNewTab').click()");
                await(view, STORE + ".getters.getActiveTab?.loadState === 'loaded' && " +
                    "!" + STORE + ".getters.getTabHistoryState(" + STORE + ".getters.getActiveTabId).canGoBack");
                Thread.sleep(200);
                scenario.onActivity(activity -> assertTrue("Root delegates Back to Android",
                    !activity.getOnBackPressedDispatcher().hasEnabledCallbacks()));
            } finally {
                // Release any pointer if an assertion failed during the swipe.
                MotionEvent release = MotionEvent.obtain(SystemClock.uptimeMillis(), SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, 320, 600, 0);
                release.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                try { InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(release, true); }
                finally { release.recycle(); }
                evaluate(view, "if (" + STORE + ".getters.getIsSideNavOpen) " + STORE + ".commit('toggleSideNav');" +
                    STORE + ".commit('setConfirmCloseApp', window.__backConfirm)");
                restoreDrawer(scenario, view);
            }
        }
    }

    private static void touch(long downTime, int action, float x, float y) {
        touch(downTime, SystemClock.uptimeMillis(), action, x, y);
    }

    private static void touch(long downTime, long eventTime, int action, float x, float y) {
        MotionEvent event = MotionEvent.obtain(downTime, eventTime, action, x, y, 0);
        event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        try {
            boolean injected = InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(event, true);
            if (action != MotionEvent.ACTION_CANCEL) assertTrue("Touch event injected", injected);
        } finally {
            event.recycle();
        }
    }

    private static WebView ready(ActivityScenario<MainActivity> scenario) throws Exception {
        AtomicReference<WebView> reference = new AtomicReference<>();
        scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
        WebView view = reference.get();
        await(view, "!!document.querySelector('.app') && " + STORE + ".getters.getActiveTab?.loadState === 'loaded'");
        TutorialTestHelper.dismissIfPending(view);
        evaluate(view, """
            (() => {
                const root = document.querySelector('#app').__vue_app__._container._vnode.component;
                const routerKey = Object.getOwnPropertySymbols(root.provides).find(key =>
                    typeof root.provides[key]?.push === 'function' && typeof root.provides[key]?.resolve === 'function');
                window.__backRouter = root.provides[routerKey];
                // Home is the landing page; replace it so Back at the root still asks to close the app.
                window.__backRouter.replace('/subscriptions');
            })()
            """);
        await(view, STORE + ".getters.getActiveTab.route.path === '/subscriptions'");
        return view;
    }

    private void prepareDrawer(ActivityScenario<MainActivity> scenario, WebView view) throws Exception {
        scenario.onActivity(activity -> {
            drawerOriginalOrientation = activity.getRequestedOrientation();
            activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        });
        evaluate(view, """
            (() => {
                const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                const values = { UiScale: 85, HideSideBarOnWatchPages: true, ReducedMotion: 'off' };
                window.__backDrawerSettings = Object.fromEntries(Object.keys(values).map(
                    key => [key, structuredClone(store.getters['get' + key])]
                ));
                for (const [key, value] of Object.entries(values)) store.commit('set' + key, value);
                window.__backRouter.push('/watch/abcdefghijk');
            })()
            """);
        await(view, "innerWidth > 680 && document.querySelector('.app').classList.contains('watchSideNavOverlay')");
    }

    private void restoreDrawer(ActivityScenario<MainActivity> scenario, WebView view) throws Exception {
        evaluate(view, "for (const [key, value] of Object.entries(window.__backDrawerSettings ?? {})) " +
            STORE + ".commit('set' + key, value); window.__backRouter.push('/subscriptions'); delete window.__backDrawerSettings");
        await(view, STORE + ".getters.getActiveTab.route.path === '/subscriptions'");
        scenario.onActivity(activity -> activity.setRequestedOrientation(drawerOriginalOrientation));
        Thread.sleep(200);
    }

    /** Starts a gesture at 0, then moves the finger across that share of the page. */
    private static void slide(WebView view, float fraction, int edge) {
        float width = view.getWidth();
        float x = edge == BackEventCompat.EDGE_LEFT ? fraction * width : width * (1 - fraction);
        if (fraction == 0f) {
            onMain(activity -> activity.getOnBackPressedDispatcher().dispatchOnBackStarted(new BackEventCompat(x, 400, 0, edge)));
        } else {
            onMain(activity -> activity.getOnBackPressedDispatcher().dispatchOnBackProgressed(new BackEventCompat(x, 400, fraction, edge)));
        }
    }

    private static void start(int edge) {
        onMain(activity -> activity.getOnBackPressedDispatcher().dispatchOnBackStarted(new BackEventCompat(0, 400, 0, edge)));
    }

    private static void progress(float progress, int edge) {
        onMain(activity -> activity.getOnBackPressedDispatcher().dispatchOnBackProgressed(new BackEventCompat(100, 400, progress, edge)));
    }

    /**
     * Runs on the main thread like ActivityScenario.onActivity, which first waits
     * for the thread to go idle. Playing video can postpone that indefinitely on
     * a slow device.
     */
    private static void onMain(ActivityScenario.ActivityAction<MainActivity> action) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            for (androidx.test.runner.lifecycle.Stage stage : new androidx.test.runner.lifecycle.Stage[] {
                    androidx.test.runner.lifecycle.Stage.RESUMED, androidx.test.runner.lifecycle.Stage.PAUSED,
                    androidx.test.runner.lifecycle.Stage.STARTED}) {
                for (android.app.Activity activity : androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
                        .getInstance().getActivitiesInStage(stage)) {
                    if (activity instanceof MainActivity) {
                        action.perform((MainActivity) activity);
                        return;
                    }
                }
            }
            throw new AssertionError("MainActivity is running");
        });
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        assertTrue("JavaScript responds", evaluated.await(15, TimeUnit.SECONDS));
        return result.get();
    }

    private static void await(WebView view, String script) throws Exception {
        long deadline = android.os.SystemClock.uptimeMillis() + 15000;
        while (android.os.SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(view, script))) return;
            Thread.sleep(100);
        }
        assertEquals(script + " (state: " + evaluate(view, "JSON.stringify({ tab: " + STORE +
            ".getters.getActiveTab, presented: " + STORE + ".getters.getPresentedTabId, " +
            "keep: " + STORE + ".getters.getKeepPlayingOnNavigation, motion: document.documentElement.dataset.reducedMotion," +
            "width: innerWidth, height: innerHeight, paused: window.__backVideo?.paused, player: document.querySelector('.ftVideoPlayer')?.className, " +
            "state: (() => { const s = window.__backWatch?.()?.$refs.player?.$?.setupState; " +
            "return s && { active: s.isActiveTab, suspended: s.isPlayerSuspended, mini: s.scrollMiniPlayerActive, full: s.fullWindowEnabled }; })(), " +
            "modal: window.__modalElement && { connected: window.__modalElement.isConnected, classes: window.__modalElement.className, " +
            "opacity: getComputedStyle(window.__modalElement).opacity, animations: window.__modalElement.getAnimations().map(a => ({time:a.currentTime,state:a.playState})), " +
            "nested: window.__modalElement.hasAttribute('data-android-back-nested') }, " +
            "settingsOpen: " + STORE + ".getters.getSettingsWindowOpen, sideNav: " + STORE + ".getters.getIsSideNavOpen, " +
            "focused: document.activeElement?.className })") + ")", "true", evaluate(view, script));
    }
}
