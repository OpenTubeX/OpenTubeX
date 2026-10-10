package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.graphics.Bitmap;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class SearchCookiesTest {
    private static final String STORE = "document.querySelector('#app').__vue_app__.config.globalProperties.$store";

    @Test public void savedSessionEnablesAgeGateAndEmptySearchRetries() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String originalNightMode = shell("cmd uimode night").trim().replace("Night mode: ", "");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            await(view, "!!document.querySelector('.app')");
            await(view, STORE + ".getters.getActiveTab?.loadState === 'loaded'");
            await(view, "localStorage.getItem('opentubex.tutorial.audience') === 'completed' || !!document.querySelector('.tutorialActions button')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            await(view, "!document.querySelector('.tutorialOverlay')");
            evaluate(view, """
                (async () => {
                    const app = document.querySelector('#app').__vue_app__;
                    const store = app.config.globalProperties.$store;
                    const values = { CurrentLocale: 'en-US', CapacitorLayoutMode: 'phone',
                        BackendPreference: 'local', BackendFallback: false, ShowFamilyFriendlyOnly: false,
                        YtDlpPlaybackAuthMode: 'file', YtDlpPlaybackCookiesPath: '',
                        BaseTheme: 'system', SystemDarkTheme: 'dark', SystemLightTheme: 'light',
                        MainColor: 'Red', SecColor: 'Blue', IconPack: 'material' };
                    window.__searchCookieSaved = Object.fromEntries(Object.keys(values).map(key =>
                        [key, structuredClone(store.getters['get' + key])]));
                    for (const [key, value] of Object.entries(values)) store.commit('set' + key, value);
                    await store.dispatch('triggerCurrentLocaleSideEffects', 'en-US');
                    const root = app._container._vnode.component;
                    const routerKey = Object.getOwnPropertySymbols(root.provides).find(key =>
                        typeof root.provides[key]?.push === 'function' && typeof root.provides[key]?.resolve === 'function');
                    window.__searchCookieRouter = root.provides[routerKey];
                    window.__searchCookieRoute = window.__searchCookieRouter.currentRoute.value.fullPath;
                    window.__searchCookieNative = Capacitor.nativePromise;
                    window.__searchCookieRequests = [];
                    window.__searchCookieEmpty = false;
                    Capacitor.nativePromise = function(plugin, method, options, ...rest) {
                        if (plugin === 'CapacitorHttp' && method === 'request' && options.url.includes('/youtubei/v1/search')) {
                            window.__searchCookieParams = JSON.parse(options.data).params;
                            return Promise.resolve({ status: 200, headers: {}, url: options.url, data: {
                                contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: {
                                    contents: [{ itemSectionRenderer: { contents: window.__searchCookieEmpty ? [] : [{
                                        backgroundPromoRenderer: { title: { simpleText: 'Confirm your age' },
                                            bodyText: { simpleText: 'These results may be inappropriate for some users.' },
                                            ctaButton: { buttonRenderer: { navigationEndpoint: { signInEndpoint: {} } } } }
                                    }] } }]
                                } } } }
                            } });
                        }
                        if (plugin === 'YtDlp' && method === 'extract') {
                            window.__searchCookieRequests.push(options);
                            if (new URL(options.args.at(-1)).pathname === '/playlist') {
                                return Promise.resolve({ stdout: JSON.stringify({ playlist_count: 10,
                                    thumbnails: [{ url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQSTkBAAHQAUHAZ3dkAAAAAElFTkSuQmCC' }],
                                    entries: [{ id: 'dQw4w9WgXcQ' }] }) });
                            }
                            return new Promise((resolve, reject) => {
                                window.__searchCookieResolve = resolve;
                                window.__searchCookieReject = reject;
                            });
                        }
                        return window.__searchCookieNative.call(this, plugin, method, options, ...rest);
                    };
                    await window.__searchCookieRouter.push('/history');
                    await window.__searchCookieRouter.push('/search/age%20restricted%20search?type=video');
                })()
                """);
            try {
                await(view, "document.querySelector('.searchNotice h3')?.textContent === 'Confirm your age'");
                await(view, "document.querySelector('.searchNotice')?.textContent.includes('Configure')");
                assertEquals("No retry without cookies", "false", evaluate(view, "!!document.querySelector('.searchRetryButton')"));
                evaluate(view, STORE + ".commit('setYtDlpPlaybackCookiesPath', '/private/yt-dlp-cookies.txt')");
                await(view, "!!document.querySelector('.searchRetryButton')");
                for (String pack : new String[] {"material", "remix"}) {
                    evaluate(view, "window.__searchCookiePackReady = false; " + STORE + ".dispatch('updateIconPack', '" + pack + "').then(() => window.__searchCookiePackReady = true)");
                    await(view, "window.__searchCookiePackReady && !!document.querySelector('.searchRetryButton svg')");
                    shell("cmd uimode night yes");
                    await(view, "document.body.classList.contains('dark')");
                    capture(view, context, "search-cookies-" + pack + "-dark.png");
                    shell("cmd uimode night no");
                    await(view, "document.body.classList.contains('light')");
                    capture(view, context, "search-cookies-" + pack + "-light.png");
                }
                evaluate(view, STORE + ".commit('setShowFamilyFriendlyOnly', true)");
                await(view, "!document.querySelector('.searchRetryButton')");
                evaluate(view, STORE + ".commit('setShowFamilyFriendlyOnly', false)");
                await(view, "!!document.querySelector('.searchRetryButton')");
                evaluate(view, "document.querySelector('.searchRetryButton').click()");
                await(view, "document.querySelector('.searchRetryButton')?.disabled && !!window.__searchCookieResolve");
                assertEquals("The native extraction receives the saved session and encoded filters", "true", evaluate(view, """
                    (() => {
                        const request = window.__searchCookieRequests[0];
                        const args = request.args;
                        const url = new URL(args.at(-1));
                        return request.cookies === '/private/yt-dlp-cookies.txt' &&
                            args[args.indexOf('--playlist-start') + 1] === '1' &&
                            url.searchParams.get('search_query') === 'age restricted search' &&
                            url.searchParams.get('sp') === decodeURIComponent(window.__searchCookieParams);
                    })()
                    """));
                JSONArray args = new JSONArray(evaluate(view, "window.__searchCookieRequests[0].args"));
                assertEquals("Search options pass native validation", args.toString(),
                    new JSONArray(YtDlpArguments.validate(args)).toString());
                evaluate(view, "window.__searchCookieReject(new Error('Fixture search failure'))");
                await(view, "!!document.querySelector('[role=alert]') && !document.querySelector('.searchRetryButton').disabled");
                evaluate(view, "document.querySelector('.searchRetryButton').click()");
                await(view, "window.__searchCookieRequests.length === 2");
                evaluate(view, "window.__searchCookieResolve({ stdout: JSON.stringify({ entries: [{ id: 'dQw4w9WgXcQ', title: 'Recovered cookie search result' }, { id: 'PLfixture', ie_key: 'YoutubeTab', title: 'Recovered playlist' }] }) })");
                await(view, "!!document.querySelector('.ft-list-item') && !document.querySelector('.searchRetryButton') && !document.querySelector('.searchNotice')");
                await(view, "[...document.querySelectorAll('.ft-list-item')].some(card => card.textContent.includes('Recovered playlist') && card.querySelector('.videoCountContainer .inner')?.textContent.trim() === '10' && card.querySelector('.thumbnailImage')?.naturalWidth > 0)");
                JSONArray playlistArgs = new JSONArray(evaluate(view, "window.__searchCookieRequests[2].args"));
                assertEquals("Playlist options pass native validation", playlistArgs.toString(),
                    new JSONArray(YtDlpArguments.validate(playlistArgs)).toString());
                assertEquals("Playlist metadata uses the saved session", "true", evaluate(view,
                    "window.__searchCookieRequests[2].cookies === '/private/yt-dlp-cookies.txt'"));
                assertEquals("Recovered results stay out of the shared search cache", "false", evaluate(view,
                    STORE + ".getters.getSessionSearchHistory.some(entry => entry.data.some(result => result.title === 'Recovered cookie search result'))"));
                evaluate(view, "window.__searchCookieEmpty = true; window.__searchCookieRouter.push('/search/empty%20search')");
                await(view, "!!document.querySelector('.searchHint') && !!document.querySelector('.searchRetryButton')");
                evaluate(view, "document.querySelector('.searchRetryButton').click()");
                await(view, "window.__searchCookieRequests.length === 4");
                evaluate(view, "window.__searchCookieResolve({ stdout: JSON.stringify({ entries: [] }) })");
                await(view, "!!document.querySelector('[role=alert]') && !document.querySelector('.searchRetryButton').disabled");
            } finally {
                evaluate(view, """
                    (() => {
                        Capacitor.nativePromise = window.__searchCookieNative;
                        window.__searchCookieResolve?.({ stdout: '{"entries":[]}' });
                        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                        for (const [key, value] of Object.entries(window.__searchCookieSaved)) store.commit('set' + key, value);
                        store.dispatch('updateIconPack', window.__searchCookieSaved.IconPack);
                        store.dispatch('triggerCurrentLocaleSideEffects', window.__searchCookieSaved.CurrentLocale);
                        window.__searchCookieRouter.push(window.__searchCookieRoute);
                    })()
                    """);
            }
        } finally {
            shell("cmd uimode night " + originalNightMode);
        }
    }

    private static void capture(WebView view, Context context, String filename) throws Exception {
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        // The theme class changes before the button's 150ms color transition ends.
        Thread.sleep(250);
        JSONArray bounds = new JSONArray(evaluate(view, """
            (() => {
                const notice = document.querySelector('.searchNotice').getBoundingClientRect();
                return [notice.x, notice.y - 8, notice.width, notice.height + 16, innerWidth];
            })()
            """));
        int[] origin = new int[2];
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.getLocationOnScreen(origin));
        double scale = view.getWidth() / bounds.getDouble(4);
        Bitmap screen = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        Bitmap crop = Bitmap.createBitmap(screen, origin[0] + (int) (bounds.getDouble(0) * scale),
            origin[1] + (int) (bounds.getDouble(1) * scale), (int) (bounds.getDouble(2) * scale), (int) (bounds.getDouble(3) * scale));
        try (FileOutputStream output = new FileOutputStream(new File(context.getFilesDir(), filename))) {
            crop.compress(Bitmap.CompressFormat.PNG, 100, output);
        } finally { crop.recycle(); screen.recycle(); }
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value); latch.countDown();
        }));
        assertTrue("JavaScript responds", latch.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private static String shell(String command) throws Exception {
        try (ParcelFileDescriptor descriptor = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
            FileInputStream input = new FileInputStream(descriptor.getFileDescriptor())) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toString("UTF-8");
        }
    }

    private static void await(WebView view, String condition) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 15000;
        while (SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(view, condition))) return;
            Thread.sleep(100);
        }
        assertEquals(condition + "; notice: " + evaluate(view, "document.querySelector('.searchNotice')?.textContent") +
            "; retry: " + evaluate(view, "document.querySelector('.searchRetryButton')?.textContent") +
            "; scheme: " + evaluate(view, "matchMedia('(prefers-color-scheme: dark)').matches"), "true", evaluate(view, condition));
    }
}
