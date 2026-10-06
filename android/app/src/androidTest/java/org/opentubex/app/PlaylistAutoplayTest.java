package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PlaylistAutoplayTest {
    @Test
    public void closedPhonePlaylistAdvancesAfterVideoEnds() throws Exception {
        verifyAutoplay(false, false);
    }

    @Test
    public void cachedYoutubePlaylistAdvancesWhileContinuationIsStalled() throws Exception {
        verifyAutoplay(true, false);
    }

    @Test
    public void cachedYoutubePlaylistAdvancesAfterContinuationFailure() throws Exception {
        verifyAutoplay(true, true);
    }

    @Test
    public void playlistBoundaryWaitsForContinuationWithoutLoop() throws Exception {
        verifyAutoplay(true, false, true, false);
    }

    @Test
    public void playlistBoundaryWaitsForContinuationWithLoop() throws Exception {
        verifyAutoplay(true, false, true, true);
    }

    private void verifyAutoplay(boolean youtube, boolean failContinuation) throws Exception {
        verifyAutoplay(youtube, failContinuation, false, false);
    }

    private void verifyAutoplay(boolean youtube, boolean failContinuation, boolean atBoundary, boolean loop) throws Exception {
        String media;
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("demo.webm")) {
            media = android.util.Base64.encodeToString(YtDlpFiles.read(input, 1024 * 1024), android.util.Base64.NO_WRAP);
        }
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            await(view, "!!document.querySelector('#app')?.__vue_app__ && !!document.querySelector('.profileTrigger')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            await(view, "!document.querySelector('.tutorialOverlay')");
            evaluate(view, """
                (async () => {
                    const app = document.querySelector('#app').__vue_app__;
                    const store = app.config.globalProperties.$store;
                    const values = { VideoPlaybackEngine: 'built-in', AutoplayVideos: true,
                        AutoplayPlaylists: true, DefaultInterval: 3, UseSponsorBlock: false,
                        UseReturnYouTubeDislikes: false, CapacitorLayoutMode: 'phone',
                        BackendPreference: 'local', BackendFallback: false, InternetConnectivityChecks: false };
                    window.__playlistSettings = Object.fromEntries(Object.keys(values).map(
                        key => [key, structuredClone(store.getters['get' + key])]
                    ));
                    for (const [key, value] of Object.entries(values)) store.commit('set' + key, value);
                    window.__playlistFetch = window.fetch;
                    window.__playlistContinuationRequested = false;
                    window.fetch = (url, options) => String(url).startsWith('https://localhost/')
                        ? window.__playlistFetch(url, options) : Promise.reject(new Error('Offline playlist test'));
                    const root = app._container._vnode.component;
                    const routerKey = Object.getOwnPropertySymbols(root.provides).find(key =>
                        typeof root.provides[key]?.push === 'function' && typeof root.provides[key]?.resolve === 'function');
                    window.__playlistRouter = root.provides[routerKey];
                    window.__playlistRoute = window.__playlistRouter.currentRoute.value.fullPath;
                    await window.__playlistRouter.push('/userplaylists');
                    window.__playlistWatch = () => {
                        const find = vnode => {
                            if (vnode?.component?.type?.name === 'Watch') return vnode.component.proxy;
                            const subtree = vnode?.component?.subTree;
                            if (subtree) { const match = find(subtree); if (match) return match; }
                            for (const child of Array.isArray(vnode?.children) ? vnode.children : []) {
                                const match = find(child); if (match) return match;
                            }
                        };
                        return find(app._container._vnode);
                    };
                    await store.dispatch('addPlaylist', {
                        _id: 'autoplay-regression', playlistName: 'Autoplay regression', protected: false,
                        description: '', videos: ['jNQXAC9IVRw', 'abcdefghijk'].map((videoId, i) => ({
                            videoId, playlistItemId: 'autoplay-' + i, title: 'Playlist video ' + (i + 1),
                            author: 'Test', lengthSeconds: 10, type: 'video'
                        }))
                    });
                    window.__playlistNativePromise = window.Capacitor.nativePromise;
                    window.Capacitor.nativePromise = function(plugin, method, options, ...rest) {
                        if (plugin === 'CapacitorHttp' && method === 'request') {
                            if (String(options.data).includes('autoplay-continuation')) {
                                window.__playlistContinuationRequested = true;
                                if (FAIL_CONTINUATION) return Promise.resolve({ status: 500, headers: {},
                                    data: 'Continuation failed', url: options.url });
                                return new Promise(resolve => { window.__playlistFinishContinuation = resolve; });
                            }
                            return Promise.reject(new Error('Offline playlist test'));
                        }
                        return window.__playlistNativePromise.call(this, plugin, method, options, ...rest);
                    };
                    if (YOUTUBE) {
                        store.commit('setCachedPlaylist', {
                            tabId: store.getters.getActiveTab.id,
                            value: { id: 'youtube-autoplay', title: 'YouTube autoplay regression', totalVideoCount: 100,
                                channelName: 'Test', channelId: '',
                                items: store.getters.getPlaylist('autoplay-regression').videos.slice(0, AT_BOUNDARY ? 1 : 2),
                                continuationData: JSON.stringify({ context: {
                                    client: { clientName: 'WEB', clientVersion: '2.20261006.00.00' }, user: {}, request: {}
                                }, path: '/browse', payload: { continuation: 'autoplay-continuation' } })
                            }
                        });
                        await window.__playlistRouter.push('/watch/jNQXAC9IVRw?playlistId=youtube-autoplay');
                    } else {
                        await window.__playlistRouter.push('/watch/jNQXAC9IVRw?playlistId=autoplay-regression&playlistType=user&playlistItemId=autoplay-0');
                    }
                })()
                """.replace("YOUTUBE", String.valueOf(youtube)).replace("FAIL_CONTINUATION", String.valueOf(failContinuation))
                    .replace("AT_BOUNDARY", String.valueOf(atBoundary)));
            try {
                await(view, "!!window.__playlistWatch() && window.__playlistWatch().onMountedRun && window.__playlistWatch().preparingVideoLoadGeneration === null");
                if (loop) evaluate(view, "document.querySelector('.watchVideoPlaylist button[aria-label=\"Loop Playlist\"]').click()");
                loadMedia(view, media, "Playlist video 1");
                await(view, "document.querySelector('.ftVideoPlayer video')?.readyState >= 2");
                if (youtube) await(view, "window.__playlistContinuationRequested === true");
                evaluate(view, "if (!window.__playlistWatch().autoplayEnabled) window.__playlistWatch().toggleAutoplay()");
                assertEquals("Playlist autoplay is enabled", "true", evaluate(view, "window.__playlistWatch().autoplayEnabled"));
                assertEquals("Phone playlist stays closed during playback", "true", evaluate(view,
                    "window.__playlistWatch().phonePanelsEnabled && window.__playlistWatch().mobilePanel === null"));
                evaluate(view, "window.__playlistVideo = document.querySelector('.ftVideoPlayer video');" +
                    "window.__playlistEnded = false; window.__playlistVideo.addEventListener('ended', () => window.__playlistEnded = true);" +
                    "window.__playlistVideo.currentTime = window.__playlistVideo.duration - 0.3; window.__playlistVideo.play()");
                await(view, "window.__playlistEnded");
                if (atBoundary) {
                    await(view, "window.__playlistWatch().waitingForPlaylistContinuation === true");
                    assertEquals("Pending pages cannot wrap or start a countdown", "true", evaluate(view,
                        "window.__playlistRouter.currentRoute.value.params.id === 'jNQXAC9IVRw' && !document.querySelector('.autoplayCountdownOverlay')"));
                    evaluate(view, """
                        window.__playlistFinishContinuation({ status: 200, headers: { 'Content-Type': 'application/json' },
                            url: 'https://www.youtube.com/youtubei/v1/browse', data: {
                                onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [{
                                    playlistVideoRenderer: {
                                        videoId: 'abcdefghijk',
                                        title: { simpleText: 'Playlist video 2', accessibility: { accessibilityData: { label: 'Playlist video 2' } } },
                                        index: { simpleText: '2' },
                                        shortBylineText: { runs: [{ text: 'Test', navigationEndpoint: { browseEndpoint: { browseId: 'UCtest' } } }] },
                                        thumbnail: { thumbnails: [] }, isPlayable: true, lengthSeconds: '10',
                                        lengthText: { simpleText: '0:10' }, navigationEndpoint: { watchEndpoint: { videoId: 'abcdefghijk' } }
                                    }
                                }] } }]
                            }
                        });
                        """);
                }
                await(view, "!!document.querySelector('.autoplayCountdownOverlay')");
                await(view, "window.__playlistRouter.currentRoute.value.params.id === 'abcdefghijk'");
                assertEquals("Advance preserves playlist identity", "true", evaluate(view,
                    youtube ? "window.__playlistRouter.currentRoute.value.query.playlistId === 'youtube-autoplay'"
                        : "window.__playlistRouter.currentRoute.value.query.playlistItemId === 'autoplay-1'"));
                await(view, "window.__playlistWatch().videoId === 'abcdefghijk' && window.__playlistWatch().preparingVideoLoadGeneration === null");
                loadMedia(view, media, "Playlist video 2");
                await(view, "document.querySelector('.ftVideoPlayer video')?.readyState >= 2 && !document.querySelector('.ftVideoPlayer video').paused && document.querySelector('.ftVideoPlayer video').currentTime > 0.1");
            } finally {
                String cleanup = """
                    (async () => {
                        window.fetch = window.__playlistFetch;
                        if (window.__playlistNativePromise) window.Capacitor.nativePromise = window.__playlistNativePromise;
                        window.__playlistFinishContinuation?.({ status: 500, headers: {}, data: 'Continuation failed', url: 'https://www.youtube.com/youtubei/v1/browse' });
                        await window.__playlistRouter.push(window.__playlistRoute);
                        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                        for (const [key, value] of Object.entries(window.__playlistSettings)) store.commit('set' + key, value);
                        await store.dispatch('removePlaylist', 'autoplay-regression');
                        window.__playlistRestored = true;
                    })()
                    """;
                InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(cleanup, null));
                await(view, "window.__playlistRestored === true");
            }
        }
    }

    private static void loadMedia(WebView view, String media, String title) throws Exception {
        evaluate(view, """
            (() => {
                const watch = window.__playlistWatch();
                watch.videoLoadGeneration++;
                Object.assign(watch, { isLoading: false, ytDlpStreamsPending: false, errorMessage: null,
                    isUpcoming: false, isLive: false, localFilePlayback: true, activeFormat: 'legacy',
                    videoTitle: 'TITLE', videoLengthSeconds: 10,
                    legacyFormats: [{ itag: 0, qualityLabel: 'Test', mimeType: 'video/webm',
                        width: 320, height: 180, bitrate: 0, localFile: true, url: 'data:video/webm;base64,MEDIA' }] });
            })()
            """.replace("MEDIA", media).replace("TITLE", title));
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
