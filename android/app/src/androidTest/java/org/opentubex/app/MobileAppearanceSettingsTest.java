package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.graphics.Bitmap;
import android.graphics.Color;
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
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class MobileAppearanceSettingsTest {
    @Test
    public void pinchGesturesKeepTheConfiguredUiScale() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            boolean[] builtInZoom = new boolean[1];
            scenario.onActivity(activity -> {
                builtInZoom[0] = view.getSettings().getBuiltInZoomControls();
                // Exercise gesture-enabled WebViews as well as Capacitor's default.
                // Disabling page zoom must not rely only on the built-in-controls flag.
                view.getSettings().setBuiltInZoomControls(true);
            });
            try {
                prepare(view);
                evaluate(view, """
                    (() => {
                        const target = document.createElement('div');
                        target.id = 'pinch-test-target';
                        target.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:var(--bg-color)';
                        target.textContent = 'Pinch zoom regression';
                        document.body.append(target);
                    })()
                    """);
                for (int scale : new int[] {100, 75, 125, 150}) {
                    evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', " + scale + ")");
                    awaitCondition(view, "Math.abs(window.visualViewport.scale - " + scale / 100.0 + ") < 0.01");
                    for (boolean spread : new boolean[] {true, false}) {
                        pinch(view, spread);
                        Thread.sleep(300);
                        double actual = Double.parseDouble(evaluate(view, "window.visualViewport.scale"));
                        assertEquals("Pinching must keep the configured " + scale + "% UI scale", scale / 100.0, actual, 0.01);
                    }
                }
            } finally {
                scenario.onActivity(activity -> view.getSettings().setBuiltInZoomControls(builtInZoom[0]));
                evaluate(view, "document.querySelector('#pinch-test-target')?.remove()");
                restore(view);
            }
        }
    }

    private static void pinch(WebView view, boolean spread) throws Exception {
        float[] geometry = new float[3];
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            int[] origin = new int[2];
            view.getLocationOnScreen(origin);
            geometry[0] = origin[0] + view.getWidth() / 2f;
            geometry[1] = origin[1] + view.getHeight() / 2f;
            geometry[2] = view.getWidth();
        });
        long downTime = SystemClock.uptimeMillis();
        float start = geometry[2] * (spread ? 0.1f : 0.35f);
        float end = geometry[2] * (spread ? 0.35f : 0.1f);
        touch(downTime, MotionEvent.ACTION_DOWN, geometry[0] - start, geometry[1]);
        MotionEvent.PointerProperties[] properties = new MotionEvent.PointerProperties[2];
        MotionEvent.PointerCoords[] coordinates = new MotionEvent.PointerCoords[2];
        for (int i = 0; i < 2; i++) {
            properties[i] = new MotionEvent.PointerProperties();
            properties[i].id = i;
            properties[i].toolType = MotionEvent.TOOL_TYPE_FINGER;
            coordinates[i] = new MotionEvent.PointerCoords();
            coordinates[i].y = geometry[1];
            coordinates[i].pressure = 1;
            coordinates[i].size = 1;
        }
        for (int step = 0; step <= 21; step++) {
            float distance = start + (end - start) * Math.min(step, 20) / 20f;
            coordinates[0].x = geometry[0] - distance;
            coordinates[1].x = geometry[0] + distance;
            int action = step == 0
                ? MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT)
                : step == 21 ? MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT)
                : MotionEvent.ACTION_MOVE;
            MotionEvent event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action,
                2, properties, coordinates, 0, 0, 1, 1, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
            InstrumentationRegistry.getInstrumentation().sendPointerSync(event);
            event.recycle();
            Thread.sleep(20);
        }
        touch(downTime, MotionEvent.ACTION_UP, geometry[0] - end, geometry[1]);
    }

    @Test
    public void alwaysShowScrollbarsControlsNativePageFading() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            String store = "document.querySelector('#app').__vue_app__.config.globalProperties.$store";
            String saved = evaluate(view, store + ".getters.getAlwaysShowScrollbars");
            try {
                evaluate(view, """
                    (() => {
                        const style = document.createElement('style');
                        style.id = 'native-scrollbar-test-style';
                        style.textContent = '#app { display: none !important; } html, body { background: #ff00ff !important; overflow-y: auto !important; }';
                        document.head.append(style);
                        const content = document.createElement('div');
                        content.id = 'native-scrollbar-test-content';
                        content.style.height = '6000px';
                        document.body.append(content);
                    })()
                    """);
                for (boolean enabled : new boolean[] {false, true, false}) {
                    evaluate(view, store + ".commit('setAlwaysShowScrollbars', " + enabled + ")");
                    awaitScrollbarFading(scenario, view, !enabled);
                    WebView currentView = view;
                    scenario.onActivity(activity -> {
                        assertTrue("The native page scrollbar stays enabled", currentView.isVerticalScrollBarEnabled());
                        assertEquals("Native scrollbar fading follows Always Show Scrollbars", !enabled,
                            currentView.isScrollbarFadingEnabled());
                    });
                    evaluate(view, "window.scrollTo(0, 1200)");
                    awaitCondition(view, "window.scrollY > 1000");
                    assertIdlePageScrollbar(scenario, view, enabled);
                }
                // Enabling the preference must also cancel a fade from recent scrolling.
                evaluate(view, "window.scrollTo(0, 1500)");
                awaitCondition(view, "window.scrollY >= 1499");
                evaluate(view, store + ".commit('setAlwaysShowScrollbars', true)");
                awaitScrollbarFading(scenario, view, false);
                assertIdlePageScrollbar(scenario, view, true);
                evaluate(view, store + ".dispatch('updateAlwaysShowScrollbars', true).then(() => window.__scrollbarSettingSaved = true)");
                awaitCondition(view, "window.__scrollbarSettingSaved === true");
                scenario.recreate();
                view = webView(scenario);
                awaitScrollbarFading(scenario, view, false);
            } finally {
                evaluate(view, "document.querySelector('#native-scrollbar-test-style')?.remove(); document.querySelector('#native-scrollbar-test-content')?.remove(); window.scrollTo(0, 0)");
                evaluate(view, store + ".dispatch('updateAlwaysShowScrollbars', " + saved + ").then(() => window.__scrollbarSettingRestored = true)");
                awaitCondition(view, "window.__scrollbarSettingRestored === true");
                evaluate(view, "delete window.__scrollbarSettingSaved; delete window.__scrollbarSettingRestored");
            }
        }
    }

    private static void awaitScrollbarFading(ActivityScenario<MainActivity> scenario, WebView view,
        boolean expected) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 15000;
        AtomicReference<Boolean> fading = new AtomicReference<>();
        while (SystemClock.uptimeMillis() < deadline) {
            scenario.onActivity(activity -> fading.set(view.isScrollbarFadingEnabled()));
            if (Boolean.valueOf(expected).equals(fading.get())) return;
            Thread.sleep(100);
        }
        assertEquals("Native scrollbar fading follows Always Show Scrollbars", Boolean.valueOf(expected), fading.get());
    }

    private static void assertIdlePageScrollbar(ActivityScenario<MainActivity> scenario, WebView view,
        boolean visible) throws Exception {
        int[] bounds = new int[4];
        int[] idleDelay = new int[1];
        CountDownLatch rendered = new CountDownLatch(1);
        scenario.onActivity(activity -> {
            view.getLocationOnScreen(bounds);
            bounds[2] = view.getWidth();
            bounds[3] = view.getHeight();
            idleDelay[0] = view.getScrollBarDefaultDelayBeforeFade() + view.getScrollBarFadeDuration() + 500;
            view.postVisualStateCallback(0, new WebView.VisualStateCallback() {
                @Override public void onComplete(long requestId) {
                    view.postOnAnimation(() -> view.postOnAnimation(rendered::countDown));
                }
            });
        });
        assertTrue("The scroll fixture is rendered", rendered.await(10, TimeUnit.SECONDS));
        Thread.sleep(idleDelay[0]);
        long deadline = SystemClock.uptimeMillis() + 15000;
        int scrollbarPixels = 0;
        while (SystemClock.uptimeMillis() < deadline) {
            Bitmap screenshot = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            assertTrue("The screen can be captured", screenshot != null);
            try {
                scrollbarPixels = 0;
                // The fixture has a uniform magenta background. Only the native thumb
                // should draw over the right edge, away from Android's system bars.
                for (int y = bounds[1] + bounds[3] / 10; y < bounds[1] + bounds[3] * 9 / 10; y++) {
                    for (int x = bounds[0] + bounds[2] - 20; x < bounds[0] + bounds[2]; x++) {
                        if (screenshot.getPixel(x, y) != Color.MAGENTA) scrollbarPixels++;
                    }
                }
            } finally {
                screenshot.recycle();
            }
            if (visible == (scrollbarPixels > 0)) return;
            Thread.sleep(100);
        }
        assertEquals("The page scrollbar's idle visibility follows the preference (pixels: " + scrollbarPixels + ")",
            visible, scrollbarPixels > 0);
    }

    @Test
    public void tappingBesideNestedScrollbarHandleDoesNotScroll() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            try {
                prepare(view);
                evaluate(view, """
                    (() => {
                        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                        window.__scrollbarTouchWidth = store.getters.getScrollbarThumbWidth;
                        store.commit('setScrollbarThumbWidth', 4);
                    })()
                    """);
                evaluate(view, "document.querySelector('.profileTrigger').click()");
                evaluate(view, """
                    (() => {
                        const spacer = document.createElement('div');
                        spacer.id = 'scrollbar-touch-test-spacer';
                        spacer.style.height = '1200px';
                        document.querySelector('.quickSettingsContent').prepend(spacer);
                    })()
                    """);
                awaitCondition(view, """
                    (() => {
                        const bar = document.querySelector('.quickSettingsScroll .os-scrollbar-vertical.os-scrollbar-visible');
                        return !!bar && bar.querySelector('.os-scrollbar-handle').getBoundingClientRect().height <
                            bar.querySelector('.os-scrollbar-track').getBoundingClientRect().height / 2;
                    })()
                    """);
                Thread.sleep(500);
                String idleOffset = evaluate(view, "String(document.querySelector('.quickSettingsScroll').scrollTop)");
                Thread.sleep(300);
                assertEquals("The panel is idle before the touch", idleOffset,
                    evaluate(view, "String(document.querySelector('.quickSettingsScroll').scrollTop)"));
                JSONObject geometry = json(view, """
                    (() => {
                        const viewport = document.querySelector('.quickSettingsScroll');
                        const track = viewport.querySelector('.os-scrollbar-vertical .os-scrollbar-track').getBoundingClientRect();
                        const handle = viewport.querySelector('.os-scrollbar-vertical .os-scrollbar-handle').getBoundingClientRect();
                        const y = handle.top - track.top > 25 ? track.top + 15 : track.bottom - 15;
                        return {
                            x: track.x + track.width / 2, tapY: y,
                            handleTop: handle.top, handleBottom: handle.bottom,
                            viewportWidth: innerWidth, trackTop: track.top, trackBottom: track.bottom
                        };
                    })()
                    """);
                assertTrue("Tap is outside the handle: " + geometry,
                    geometry.getDouble("tapY") < geometry.getDouble("handleTop") - 5 ||
                        geometry.getDouble("tapY") > geometry.getDouble("handleBottom") + 5);
                String initialOffset = evaluate(view, "String(document.querySelector('.quickSettingsScroll').scrollTop)");
                double initialScrollTop = Double.parseDouble((String) new JSONTokener(initialOffset).nextValue());
                String tapTarget = evaluate(view, "document.elementFromPoint(" + geometry.getDouble("x") + ", " +
                    geometry.getDouble("tapY") + ")?.className");
                String handleTarget = evaluate(view, "document.elementFromPoint(" + geometry.getDouble("x") + ", " +
                    (geometry.getDouble("handleTop") + geometry.getDouble("handleBottom")) / 2 + ")?.className");
                assertTrue("The handle must remain draggable: " + handleTarget,
                    handleTarget.contains("os-scrollbar-handle"));
                assertTrue("Track touches should reach the content: " + tapTarget,
                    !tapTarget.contains("os-scrollbar"));
                float[] screenPoint = new float[2];
                float[] handlePoint = new float[2];
                float[] dragPoint = new float[2];
                scenario.onActivity(activity -> {
                    int[] origin = new int[2];
                    view.getLocationOnScreen(origin);
                    double scale = view.getWidth() / geometry.optDouble("viewportWidth");
                    screenPoint[0] = origin[0] + (float) (geometry.optDouble("x") * scale);
                    screenPoint[1] = origin[1] + (float) (geometry.optDouble("tapY") * scale);
                    handlePoint[0] = screenPoint[0];
                    handlePoint[1] = origin[1] + (float) ((geometry.optDouble("handleTop") +
                        geometry.optDouble("handleBottom")) / 2 * scale);
                    dragPoint[0] = handlePoint[0];
                    double roomAbove = geometry.optDouble("handleTop") - geometry.optDouble("trackTop");
                    double roomBelow = geometry.optDouble("trackBottom") - geometry.optDouble("handleBottom");
                    double direction = roomBelow > roomAbove ? 1 : -1;
                    dragPoint[1] = handlePoint[1] + (float) (direction * 40 * scale);
                });
                long downTime = SystemClock.uptimeMillis();
                for (int action : new int[] {MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP}) {
                    touch(downTime, action, screenPoint[0], screenPoint[1]);
                    if (action != MotionEvent.ACTION_UP) Thread.sleep(40);
                }
                Thread.sleep(300);
                assertEquals("Tapping the scrollbar track must not jump the panel (target: " + tapTarget + ")", initialOffset,
                    evaluate(view, "String(document.querySelector('.quickSettingsScroll').scrollTop)"));
                downTime = SystemClock.uptimeMillis();
                for (int action : new int[] {MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE, MotionEvent.ACTION_UP}) {
                    float[] target = action == MotionEvent.ACTION_DOWN ? handlePoint : dragPoint;
                    touch(downTime, action, target[0], target[1]);
                    if (action != MotionEvent.ACTION_UP) Thread.sleep(40);
                }
                awaitCondition(view, "Math.abs(document.querySelector('.quickSettingsScroll').scrollTop - " +
                    initialScrollTop + ") > 10");
            } finally {
                evaluate(view, """
                    (() => {
                        document.querySelector('#scrollbar-touch-test-spacer')?.remove();
                        if (window.__scrollbarTouchWidth !== undefined) {
                            document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit(
                                'setScrollbarThumbWidth', window.__scrollbarTouchWidth
                            );
                            delete window.__scrollbarTouchWidth;
                        }
                    })()
                    """);
                restore(view);
            }
        }
    }

    @Test
    public void bottomNavigationFollowsPageScrollAtDifferentScales() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            // First-run tutorial makes the navigation inert and locks native scrolling.
            awaitCondition(view, "localStorage.getItem('opentubex.tutorial.audience') === 'completed' || !!document.querySelector('.tutorialActions button')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            awaitCondition(view, "!document.querySelector('.tutorialOverlay')");
            try {
                prepare(view);
                evaluate(view, """
                    (() => {
                        const content = document.createElement('div');
                        content.id = 'mobile-navigation-scroll-fixture';
                        content.style.height = '4000px';
                        // A native test viewport exercises real DOM scroll events.
                        const nested = document.createElement('div');
                        nested.id = 'mobile-navigation-nested-fixture';
                        nested.style.cssText = 'height:100px;overflow:auto';
                        const inner = document.createElement('div');
                        inner.style.height = '1000px';
                        nested.append(inner);
                        nested.addEventListener('scroll', () => { nested.dataset.scrolled = 'true'; });
                        content.append(nested);
                        document.querySelector('.routerView').append(content);
                    })()
                    """);
                for (int scale : new int[] {100, 125, 150}) {
                    evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', " + scale + ")");
                    awaitCondition(view, "Math.abs(window.visualViewport.scale - " + scale / 100.0 + ") < 0.01");
                    evaluate(view, "window.scrollTo(0, 0)");
                    awaitCondition(view, "window.scrollY === 0 && !document.querySelector('.sideNav').classList.contains('scrollHidden')");
                    evaluate(view, "document.querySelector('#mobile-navigation-nested-fixture').scrollTop = 0");
                    awaitCondition(view, "document.querySelector('#mobile-navigation-nested-fixture').scrollTop === 0");
                    evaluate(view, "(() => { const nested = document.querySelector('#mobile-navigation-nested-fixture'); delete nested.dataset.scrolled; nested.scrollTop = 400; })()");
                    awaitCondition(view, "(() => { const nested = document.querySelector('#mobile-navigation-nested-fixture'); return nested.scrollTop === 400 && nested.dataset.scrolled === 'true'; })()");
                    assertEquals("Nested scrolling leaves the navigation visible", "true", evaluate(view,
                        "!document.querySelector('.sideNav').classList.contains('scrollHidden') && window.scrollY === 0"));
                    evaluate(view, "window.__navigationPageHeight = document.scrollingElement.scrollHeight; window.scrollTo(0, 400)");
                    awaitCondition(view, "document.querySelector('.sideNav').getBoundingClientRect().top >= window.innerHeight - 1");
                    assertEquals("Hiding keeps the page height and scroll position stable", "true", evaluate(view,
                        "document.scrollingElement.scrollHeight === window.__navigationPageHeight && Math.abs(window.scrollY - 400) <= 1"));
                    evaluate(view, "window.scrollTo(0, 360)");
                    awaitCondition(view, """
                        (() => {
                            const nav = document.querySelector('.sideNav');
                            const rect = nav.getBoundingClientRect();
                            return !nav.classList.contains('scrollHidden') && rect.top < window.innerHeight - 40 &&
                                Math.abs(rect.bottom - window.innerHeight) <= 1;
                        })()
                        """);
                    evaluate(view, "window.scrollTo(0, 600)");
                    awaitCondition(view, "document.querySelector('.sideNav').classList.contains('scrollHidden')");
                    evaluate(view, "document.querySelector('.sideNav .navOption').focus({ preventScroll: true })");
                    assertEquals("Navigation receives keyboard focus: " + evaluate(view,
                        "JSON.stringify({ active: document.activeElement.outerHTML, inert: document.querySelector('.sideNav').inert, prompts: document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.isAnyPromptOpen })"),
                        "true", evaluate(view, "document.activeElement === document.querySelector('.sideNav .navOption')"));
                    awaitCondition(view, "!document.querySelector('.sideNav').classList.contains('scrollHidden')");
                    evaluate(view, "document.activeElement.blur(); window.scrollTo(0, 800)");
                    awaitCondition(view, "document.querySelector('.sideNav').classList.contains('scrollHidden')");
                    evaluate(view, "window.scrollTo(0, 0)");
                    awaitCondition(view, "!document.querySelector('.sideNav').classList.contains('scrollHidden')");
                }
                evaluate(view, "window.scrollTo(0, 400)");
                awaitCondition(view, "document.querySelector('.sideNav').classList.contains('scrollHidden')");
                evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/userplaylists')");
                awaitCondition(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$route.path === '/userplaylists' && !document.querySelector('.sideNav').classList.contains('scrollHidden')");
            } finally {
                evaluate(view, "document.querySelector('#mobile-navigation-scroll-fixture')?.remove(); delete window.__navigationPageHeight; window.scrollTo(0, 0)");
                restore(view);
            }
        }
    }

    @Test
    public void navigationVisibilityAndCompactLabelsFollowPreferences() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            awaitCondition(view, "localStorage.getItem('opentubex.tutorial.audience') === 'completed' || !!document.querySelector('.tutorialActions button')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            awaitCondition(view, "!document.querySelector('.tutorialOverlay')");
            try {
                prepare(view);
                evaluate(view, """
                    (() => {
                        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                        for (const key of ['AlwaysShowNavigationBar', 'CompactNavigationLabels', 'HideLabelsSideBar']) {
                            window.__mobileAppearanceSaved[key] = store.getters['get' + key];
                            store.commit('set' + key, false);
                        }
                        const content = document.createElement('div');
                        content.id = 'mobile-navigation-options-fixture';
                        content.style.height = '4000px';
                        document.querySelector('.app > .flexBox').append(content);
                    })()
                    """);
                for (int scale : new int[] {100, 125}) {
                    evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', " + scale + ")");
                    awaitCondition(view, "Math.abs(window.visualViewport.scale - " + scale / 100.0 + ") < 0.01");
                    evaluate(view, "window.scrollTo(0, 0)");
                    awaitCondition(view, "window.scrollY === 0");
                    evaluate(view, "document.activeElement.blur(); window.scrollTo(0, 300)");
                    awaitCondition(view, "document.querySelector('.sideNav').classList.contains('scrollHidden')");
                    evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setAlwaysShowNavigationBar', true)");
                    awaitCondition(view, "!document.querySelector('.sideNav').classList.contains('scrollHidden')");
                    evaluate(view, "window.scrollTo(0, 600)");
                    awaitCondition(view, "Math.abs(window.scrollY - 600) <= 1");
                    awaitCondition(view, "Math.abs(document.querySelector('.sideNav').getBoundingClientRect().bottom - innerHeight) <= 1");
                    evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setAlwaysShowNavigationBar', false)");
                    evaluate(view, "window.scrollTo(0, 800)");
                    awaitCondition(view, "document.querySelector('.sideNav').classList.contains('scrollHidden')");
                    evaluate(view, "window.scrollTo(0, 0)");
                    awaitCondition(view, "!document.querySelector('.sideNav').classList.contains('scrollHidden')");
                    evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setCompactNavigationLabels', true)");
                    awaitCondition(view, """
                        (() => {
                            const labels = [...document.querySelectorAll('.sideNav .inner > .navOption:not(.mobileHidden) .navLabel')];
                            const visible = labels.filter(label => getComputedStyle(label).display !== 'none');
                            const icons = [...document.querySelectorAll('.sideNav .inner > .navOption:not(.mobileHidden) .navIcon, .moreOptionNav .navIcon')];
                            const centered = icons.every(icon => {
                                const bounds = icon.getBoundingClientRect();
                                const option = icon.closest('.navOption').getBoundingClientRect();
                                return Math.abs((bounds.top + bounds.bottom - option.top - option.bottom) / 2) <= 1 &&
                                    Math.abs(option.height - 48) <= 1;
                            });
                            return labels.length === 4 && visible.length === 0 && centered &&
                                labels.every(label => !!label.closest('.navOption').getAttribute('aria-label'));
                        })()
                        """);
                    evaluate(view, "document.querySelector('.sideNav .moreOptionNav').click()");
                    awaitCondition(view, "!!document.querySelector('.moreOptionContainer')");
                    assertEquals("Overflow labels stay readable", "true", evaluate(view,
                        """
                        (() => {
                            const labels = [...document.querySelectorAll('.moreOptionContainer .navLabel')];
                            return labels.length > 0 && labels.every(label => {
                                const bounds = label.getBoundingClientRect();
                                return getComputedStyle(label).visibility === 'visible' && bounds.width > 0 && bounds.height > 0;
                            });
                        })()
                        """));
                    evaluate(view, "document.querySelector('.moreOptionContainer a[href=\"#/subscribedchannels\"]').click()");
                    awaitCondition(view, "document.querySelector('.moreOptionNav').classList.contains('router-link-active') && getComputedStyle(document.querySelector('.moreOptionNav .navLabel')).display === 'none'");
                    evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/history')");
                    awaitCondition(view, "!!document.querySelector('.sideNav .inner > .navOption.router-link-active[href=\"#/history\"]')");
                    evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setCompactNavigationLabels', false)");
                    awaitCondition(view, """
                        (() => {
                            const labels = [...document.querySelectorAll('.sideNav .inner > .navOption:not(.mobileHidden) .navLabel, .moreOptionNav .navLabel')];
                            return labels.length === 5 && labels.every(label => {
                                const bounds = label.getBoundingClientRect();
                                return getComputedStyle(label).visibility === 'visible' && bounds.width > 0 && bounds.height > 0;
                            });
                        })()
                        """);
                }
            } finally {
                evaluate(view, "document.querySelector('#mobile-navigation-options-fixture')?.remove(); window.scrollTo(0, 0)");
                restore(view);
            }
        }
    }

    private static final String SCROLL_STATE = """
        (() => {
            const viewport = document.querySelector('.quickSettingsMenu .quickSettingsScroll');
            const content = viewport.querySelector('.quickSettingsContent');
            const contentEnd = content.getBoundingClientRect().bottom -
                viewport.getBoundingClientRect().top - viewport.clientTop + viewport.scrollTop +
                (parseFloat(getComputedStyle(viewport).paddingBottom) || 0);
            const range = Math.max(0, contentEnd - viewport.clientHeight);
            const scrollbar = viewport.querySelector('.os-scrollbar-vertical');
            const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect();
            const thumb = scrollbar.querySelector('.os-scrollbar-handle').getBoundingClientRect();
            const overflow = range > 1;
            return {
                range, offset: viewport.scrollTop,
                atEnd: Math.abs(viewport.scrollTop - range) <= 1,
                scrollbarMatches: overflow
                    ? scrollbar.classList.contains('os-scrollbar-visible') &&
                        Math.abs(thumb.height - track.height * viewport.clientHeight / contentEnd) <= 2 &&
                        Math.abs(thumb.bottom - track.bottom) <= 2
                    : !scrollbar.classList.contains('os-scrollbar-visible') ||
                        scrollbar.classList.contains('os-scrollbar-unusable')
            };
        })()
        """;

    @Test
    public void enlargedPhoneHeaderKeepsHistoryAndOverflowShortcutsAccessible() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            awaitCondition(view, "localStorage.getItem('opentubex.tutorial.audience') === 'completed' || !!document.querySelector('.tutorialActions button')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            awaitCondition(view, "!document.querySelector('.tutorialOverlay')");
            try {
                prepare(view);
                evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/userplaylists')");
                awaitCondition(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$route.path === '/userplaylists'");
                assertEquals("Phone history arrows are replaced by the tab overview", "true", evaluate(view,
                    "document.querySelector('.navBackButton').getBoundingClientRect().width === 0 && " +
                    "document.querySelector('.navForwardButton').getBoundingClientRect().width === 0"));
                awaitCondition(view, """
                    (() => {
                        const viewport = window.visualViewport;
                        const visible = element => {
                            const rect = element.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0 &&
                                getComputedStyle(element).visibility !== 'hidden';
                        };
                        if (!['.navSearchButton', '.capacitorPhoneTabSwitcherButton', '.profileTrigger']
                            .every(selector => visible(document.querySelector(selector)))) return false;
                        const buttons = [...document.querySelectorAll('.topNav button')].filter(visible);
                        return buttons.length > 0 && buttons.every(button => {
                            const rect = button.getBoundingClientRect();
                            return rect.left >= viewport.offsetLeft - 1 &&
                                rect.right <= viewport.offsetLeft + viewport.width + 1 &&
                                rect.top >= viewport.offsetTop - 1 &&
                                rect.bottom <= viewport.offsetTop + viewport.height + 1;
                        });
                    })()
                    """);
                assertEquals("Optional shortcuts leave room for the phone header", "true", evaluate(view,
                    "(document.querySelector('.downloadsButton')?.getBoundingClientRect().width ?? 0) === 0 && " +
                    "(document.querySelector('.settingsButton')?.getBoundingClientRect().width ?? 0) === 0"));
                evaluate(view, "document.querySelector('.profileTrigger').click()");
                awaitCondition(view, """
                    (() => {
                        const viewport = window.visualViewport;
                        return ['.downloadsShortcut', '.allSettingsShortcut'].every(selector => {
                            const rect = document.querySelector(selector)?.getBoundingClientRect();
                            return rect && rect.width > 0 && rect.height > 0 &&
                                rect.left >= viewport.offsetLeft - 1 &&
                                rect.right <= viewport.offsetLeft + viewport.width + 1 &&
                                rect.top >= viewport.offsetTop - 1 &&
                                rect.bottom <= viewport.offsetTop + viewport.height + 1;
                        });
                    })()
                    """);
                scenario.onActivity(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                awaitCondition(view, "document.querySelector('.profileTrigger').getAttribute('aria-expanded') === 'false'");
                String route = "document.querySelector('#app').__vue_app__.config.globalProperties.$route.fullPath";
                String firstRoute = evaluate(view,
                    "document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getPresentedTab.history[0].route.fullPath");
                String lastRoute = evaluate(view, route);
                assertTrue("The fixture retains backward and forward history", !firstRoute.equals(lastRoute));
                openPhoneTabHistory(view);
                evaluate(view, "document.querySelector('.capacitorPhoneTabHistoryEntry:first-child').click()");
                awaitCondition(view, route + " === " + firstRoute + " && !document.querySelector('.capacitorPhoneTabDialog')");
                openPhoneTabHistory(view);
                evaluate(view, "document.querySelector('.capacitorPhoneTabHistoryEntry:last-child').click()");
                awaitCondition(view, route + " === " + lastRoute + " && !document.querySelector('.capacitorPhoneTabDialog')");
            } finally {
                restore(view);
            }
        }
    }

    @Test
    public void reducingScaleClampsQuickSettingsAndUpdatesRenderedScrollbar() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            try {
                prepare(view);
                evaluate(view, "document.querySelector('.profileTrigger').click()");
                awaitCondition(view, "!!document.querySelector('.quickSettingsContent') && !!document.querySelector('.quickSettingsScroll .os-scrollbar-handle')");
                evaluate(view, """
                    (() => {
                        const viewport = document.querySelector('.quickSettingsScroll');
                        viewport.scrollTop = viewport.scrollHeight;
                    })()
                    """);
                awaitCondition(view, "(() => { const state = " + SCROLL_STATE + "; return state.offset > 0 && state.atEnd && state.scrollbarMatches; })()");
                JSONObject before = json(view, SCROLL_STATE);
                evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setUiScale', 75)");
                awaitCondition(view, "Math.abs(window.visualViewport.scale - 0.75) < 0.01");
                awaitCondition(view, "(() => { const state = " + SCROLL_STATE + "; return state.atEnd && state.scrollbarMatches; })()");
                JSONObject after = json(view, SCROLL_STATE);
                assertTrue("Reducing scale grows the viewport and shortens its scroll range: " + before + " -> " + after,
                    after.getDouble("range") < before.getDouble("range") - 1);
            } finally {
                restore(view);
            }
        }
    }

    @Test
    public void dynamicColorsFollowNativePaletteAndClearWhenDisabled() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            prepare(view);
            String store = "document.querySelector('#app').__vue_app__.config.globalProperties.$store";
            String savedTheme = evaluate(view, store + ".getters.getBaseTheme");
            try {
                evaluate(view, "document.querySelector('.profileTrigger').click()");
                awaitCondition(view, "!!document.querySelector('.quickSettingsContent select')");
                if (android.os.Build.VERSION.SDK_INT < 31) {
                    assertEquals("Dynamic option is absent on older Android", "false", evaluate(view,
                        "!!document.querySelector('.quickSettingsContent option[value=dynamic]')"));
                    return;
                }
                awaitCondition(view, "!!document.querySelector('.quickSettingsContent option[value=dynamic]')");
                evaluate(view, store + ".commit('setBaseTheme', 'dynamic')");
                String primary = "document.body.style.getPropertyValue('--primary-color')";
                awaitCondition(view, primary + " !== ''");
                android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
                boolean dark = (context.getResources().getConfiguration().uiMode &
                    android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
                    android.content.res.Configuration.UI_MODE_NIGHT_YES;
                int colorId = context.getResources().getIdentifier(
                    "system_accent1_" + (dark ? "200" : "600"), "color", "android");
                String expected = String.format(java.util.Locale.ROOT, "#%06x", context.getColor(colorId) & 0xffffff);
                assertEquals("Renderer uses the actual system accent", JSONObject.quote(expected),
                    evaluate(view, primary + ".toLowerCase()"));
                assertEquals("Dynamic fields, tracks and text retain accessible contrast", "true", evaluate(view,
                    """
                    (() => {
                        const style = getComputedStyle(document.body);
                        const color = name => style.getPropertyValue(name).trim();
                        const luminance = hex => hex.slice(1).match(/../g).map(channel => {
                            const value = parseInt(channel, 16) / 255;
                            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
                        }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
                        const contrast = (a, b) => {
                            const values = [luminance(color(a)), luminance(color(b))].sort((a, b) => b - a);
                            return (values[0] + 0.05) / (values[1] + 0.05);
                        };
                        const surfaces = ['--bg-color', '--card-bg-color', '--search-bar-color', '--dropdown-item-hover-color'];
                        return document.body.classList.contains('dynamicColors') &&
                            color('--search-bar-color') !== color('--card-bg-color') && surfaces.every(background =>
                                ['--primary-text-color', '--secondary-text-color', '--link-color', '--red-500'].every(
                                    foreground => contrast(foreground, background) >= 4.5) &&
                                ['--input-border-color', '--slider-track-color', '--toggle-track-color',
                                 '--toggle-checked-track-color', '--scrollbar-color-hover'].every(
                                    foreground => contrast(foreground, background) >= 3)) &&
                            contrast('--toggle-thumb-color', '--toggle-track-color') >= 3 &&
                            contrast('--toggle-checked-thumb-color', '--toggle-checked-track-color') >= 3;
                    })()
                    """));
                evaluate(view, "document.body.style.removeProperty('--primary-color')");
                scenario.onActivity(activity -> activity.onConfigurationChanged(
                    new android.content.res.Configuration(activity.getResources().getConfiguration())));
                awaitCondition(view, primary + ".toLowerCase() === '" + expected + "'");
                evaluate(view, store + ".commit('setBaseTheme', 'light')");
                awaitCondition(view, primary + " === '' && document.body.classList.contains('light')");
                assertEquals("Dynamic backgrounds are removed", "\"\"", evaluate(view,
                    "document.body.style.getPropertyValue('--bg-color')"));
            } finally {
                evaluate(view, store + ".commit('setBaseTheme', " + savedTheme + ")");
                restore(view);
            }
        }
    }

    @Test
    public void dynamicBackgroundRespectsSystemThemeOverlays() throws Exception {
        org.junit.Assume.assumeTrue(android.os.Build.VERSION.SDK_INT >= 31);
        android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        boolean dark = (context.getResources().getConfiguration().uiMode &
            android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
            android.content.res.Configuration.UI_MODE_NIGHT_YES;
        int backgroundId = dark ? android.R.color.system_neutral1_900 : android.R.color.system_neutral1_50;
        String expected = String.format(java.util.Locale.ROOT, "#%06x", context.getColor(backgroundId) & 0xffffff);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            String store = "document.querySelector('#app').__vue_app__.config.globalProperties.$store";
            String savedTheme = evaluate(view, store + ".getters.getBaseTheme");
            String savedWindowOpen = evaluate(view, store + ".getters.getSettingsWindowOpen");
            String savedWindowMinimized = evaluate(view, store + ".getters.getSettingsWindowMinimized");
            try {
                evaluate(view, store + ".commit('setBaseTheme', 'dynamic')");
                evaluate(view, store + ".commit('setSettingsWindowMinimized', false); " +
                    store + ".commit('setSettingsWindowOpen', true)");
                String background = "document.body.style.getPropertyValue('--bg-color').toLowerCase()";
                awaitCondition(view, background + " !== '' && !!document.querySelector('.settingsWindow')");
                assertEquals("Dynamic background respects system dark-theme overlays", JSONObject.quote(expected),
                    evaluate(view, background));
                int cardId = dark ? android.R.color.system_neutral1_800 : android.R.color.system_neutral1_100;
                String expectedCard = dark && expected.equals("#000000") ? "#191919" :
                    String.format(java.util.Locale.ROOT, "#%06x", context.getColor(cardId) & 0xffffff);
                assertEquals("Cards remain distinguishable above pure-black backgrounds", JSONObject.quote(expectedCard),
                    evaluate(view, "document.body.style.getPropertyValue('--card-bg-color').toLowerCase()"));
                int rgb = Integer.parseInt(expectedCard.substring(1), 16);
                String expectedRgb = "rgb(" + ((rgb >> 16) & 255) + ", " + ((rgb >> 8) & 255) + ", " + (rgb & 255) + ")";
                assertEquals("The visible settings panel uses the system surface", JSONObject.quote(expectedRgb),
                    evaluate(view, "getComputedStyle(document.querySelector('.settingsWindow')).backgroundColor"));
                assertEquals("The status-bar inset uses the system surface", JSONObject.quote(expectedRgb),
                    evaluate(view, "getComputedStyle(document.querySelector('.app'), '::before').backgroundColor"));
                evaluate(view, "document.body.style.removeProperty('--bg-color')");
                scenario.onActivity(activity -> activity.onConfigurationChanged(
                    new android.content.res.Configuration(activity.getResources().getConfiguration())));
                awaitCondition(view, background + " === '" + expected + "'");
            } finally {
                evaluate(view, store + ".commit('setBaseTheme', " + savedTheme + ")");
                evaluate(view, store + ".commit('setSettingsWindowOpen', " + savedWindowOpen + "); " +
                    store + ".commit('setSettingsWindowMinimized', " + savedWindowMinimized + ")");
            }
        }
    }

    @Test
    public void lineageBlackThemeUpdatesTheExistingWebView() throws Exception {
        org.junit.Assume.assumeTrue(android.os.Build.VERSION.SDK_INT >= 31);
        String overlay = "org.lineageos.overlay.customization.blacktheme";
        String overlays = shell("cmd overlay list android");
        org.junit.Assume.assumeTrue(overlays.contains(overlay));
        boolean originallyEnabled = overlays.contains("[x] " + overlay);
        org.junit.Assume.assumeTrue((InstrumentationRegistry.getInstrumentation().getTargetContext()
            .getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
            android.content.res.Configuration.UI_MODE_NIGHT_YES);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            String store = "document.querySelector('#app').__vue_app__.config.globalProperties.$store";
            String savedTheme = evaluate(view, store + ".getters.getBaseTheme");
            try {
                evaluate(view, store + ".commit('setBaseTheme', 'dynamic')");
                awaitCondition(view, "document.body.style.getPropertyValue('--primary-color') !== ''");
                for (boolean enabled : new boolean[] {false, true, false, true}) {
                    shell("cmd overlay " + (enabled ? "enable" : "disable") + " --user 0 " + overlay);
                    String expected = overlayColor("system_neutral1_900");
                    if (enabled) assertEquals("LineageOS supplies pure black", "#000000", expected);
                    awaitCondition(view, "document.body.style.getPropertyValue('--bg-color').toLowerCase() === '" + expected + "'");
                    String expectedCard = enabled ? "#191919" : overlayColor("system_neutral1_800");
                    assertEquals("Live overlay updates restore the expected card surface", JSONObject.quote(expectedCard),
                        evaluate(view, "document.body.style.getPropertyValue('--card-bg-color')"));
                }
            } finally {
                try {
                    shell("cmd overlay " + (originallyEnabled ? "enable" : "disable") + " --user 0 " + overlay);
                } finally {
                    evaluate(view, store + ".commit('setBaseTheme', " + savedTheme + ")");
                }
            }
        }
    }

    @Test
    public void systemPaletteChangeUpdatesTheExistingWebView() throws Exception {
        org.junit.Assume.assumeTrue(android.os.Build.VERSION.SDK_INT >= 31);
        android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        android.app.UiAutomation automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
        automation.adoptShellPermissionIdentity(android.Manifest.permission.WRITE_SECURE_SETTINGS);
        String setting = "theme_customization_overlay_packages";
        String originalPalette = android.provider.Settings.Secure.getString(context.getContentResolver(), setting);
        String store = "document.querySelector('#app').__vue_app__.config.globalProperties.$store";
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            String savedTheme = evaluate(view, store + ".getters.getBaseTheme");
            try {
                evaluate(view, store + ".dispatch('updateBaseTheme', 'dynamic').then(() => window.__themeSaved = true)");
                awaitCondition(view, "window.__themeSaved === true && document.body.style.getPropertyValue('--primary-color') !== ''");
                String originalColor = evaluate(view, "document.body.style.getPropertyValue('--primary-color')");
                String seed = originalPalette != null && originalPalette.contains("FF0066") ? "6750A4" : "FF0066";
                android.provider.Settings.Secure.putString(context.getContentResolver(), setting,
                    new JSONObject()
                        .put("android.theme.customization.system_palette", seed)
                        .put("android.theme.customization.accent_color", seed)
                        .put("android.theme.customization.color_source", "preset")
                        .put("android.theme.customization.theme_style", "TONAL_SPOT")
                        .toString());
                awaitCondition(view, store + ".getters.getBaseTheme === 'dynamic' && " +
                    "document.body.style.getPropertyValue('--primary-color') !== '' && " +
                    "document.body.style.getPropertyValue('--primary-color') !== " + originalColor);
            } finally {
                view = webView(scenario);
                evaluate(view, store + ".dispatch('updateBaseTheme', " + savedTheme + ").then(() => window.__themeRestored = true)");
                awaitCondition(view, "window.__themeRestored === true");
            }
        } finally {
            android.provider.Settings.Secure.putString(context.getContentResolver(), setting, originalPalette);
            automation.dropShellPermissionIdentity();
        }
    }

    private static void touch(long downTime, int action, float x, float y) {
        MotionEvent.PointerProperties properties = new MotionEvent.PointerProperties();
        properties.id = 0;
        properties.toolType = MotionEvent.TOOL_TYPE_FINGER;
        MotionEvent.PointerCoords coordinates = new MotionEvent.PointerCoords();
        coordinates.x = x;
        coordinates.y = y;
        coordinates.pressure = 1;
        coordinates.size = 1;
        MotionEvent event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action,
            1, new MotionEvent.PointerProperties[] {properties},
            new MotionEvent.PointerCoords[] {coordinates}, 0, 0, 1, 1, 0, 0,
            InputDevice.SOURCE_TOUCHSCREEN, 0);
        InstrumentationRegistry.getInstrumentation().sendPointerSync(event);
        event.recycle();
    }

    private static WebView webView(ActivityScenario<MainActivity> scenario) throws Exception {
        AtomicReference<WebView> view = new AtomicReference<>();
        scenario.onActivity(activity -> view.set(activity.getBridge().getWebView()));
        awaitCondition(view.get(), "!!document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store && !!document.querySelector('.profileTrigger')");
        return view.get();
    }

    private static void openPhoneTabHistory(WebView view) throws Exception {
        evaluate(view, "document.querySelector('.capacitorPhoneTabSwitcherButton').click()");
        awaitCondition(view, "!!document.querySelector('.capacitorPhoneTabHistoryButton')");
        evaluate(view, "document.querySelector('.capacitorPhoneTabHistoryButton').click()");
        awaitCondition(view, "!!document.querySelector('.capacitorPhoneTabHistoryEntry')");
    }

    private static void prepare(WebView view) throws Exception {
        evaluate(view, """
            (() => {
                const app = document.querySelector('#app').__vue_app__.config.globalProperties;
                const values = {
                    UiScale: 150, CapacitorLayoutMode: 'phone', EnableDownloads: true,
                    MoveDownloadsToAppHeader: true, MoveSettingsToAppHeader: true,
                    HideHeaderLogo: false, HideSearchBar: false, AlwaysShowMobileSearchBar: false,
                    AlwaysShowScrollbars: true,
                    FetchSubscriptionsAutomatically: false,
                    QuickSettings: ['baseTheme', 'mainColor', 'uiScale', 'thumbnailSize',
                        'defaultQuality', 'defaultPlayback', 'playNextVideo',
                        'enableSubtitlesByDefault', 'listType', 'playlistViewType',
                        'hideRecommendedVideos', 'hideComments', 'currentLocale', 'region']
                };
                window.__mobileAppearanceSaved = Object.fromEntries(Object.keys(values).map(
                    key => [key, structuredClone(app.$store.getters['get' + key])]
                ));
                for (const [key, value] of Object.entries(values)) app.$store.commit('set' + key, value);
                // Keep first-run UI out of the measured header without changing tutorial progress.
                const style = document.createElement('style');
                style.id = 'mobile-appearance-test-style';
                style.textContent = '.tutorialOverlay { display: none !important; }';
                document.head.append(style);
                app.$router.push('/history');
            })()
            """);
        awaitCondition(view, "Math.abs(window.visualViewport.scale - 1.5) < 0.01 && document.querySelector('#app').__vue_app__.config.globalProperties.$route.path === '/history'");
        assertTrue("Run this regression on a portrait phone with at most 440 CSS pixels at 100% scale",
            "true".equals(evaluate(view, "window.visualViewport.width * window.visualViewport.scale <= 440")));
    }

    private static void restore(WebView view) throws Exception {
        evaluate(view, """
            (() => {
                document.querySelector('.profileTrigger[aria-expanded="true"]')?.click();
                const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                for (const [key, value] of Object.entries(window.__mobileAppearanceSaved ?? {})) {
                    store.commit('set' + key, value);
                }
                delete window.__mobileAppearanceSaved;
                document.querySelector('#mobile-appearance-test-style')?.remove();
            })()
            """);
    }

    private static String overlayColor(String resource) throws Exception {
        String nativeColor = shell("cmd overlay lookup android android:color/" + resource).trim();
        java.util.regex.Matcher resolved = java.util.regex.Pattern.compile("#ff([0-9a-fA-F]{6})$").matcher(nativeColor);
        assertTrue("System resource is a resolved color: " + nativeColor, resolved.find());
        return "#" + resolved.group(1).toLowerCase(java.util.Locale.ROOT);
    }

    private static String shell(String command) throws Exception {
        try (java.io.InputStream output = new android.os.ParcelFileDescriptor.AutoCloseInputStream(
            InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command))) {
            return new java.io.BufferedReader(new java.io.InputStreamReader(output,
                java.nio.charset.StandardCharsets.UTF_8)).lines().collect(java.util.stream.Collectors.joining("\n"));
        }
    }

    private static JSONObject json(WebView view, String expression) throws Exception {
        return new JSONObject((String) new JSONTokener(evaluate(view, "JSON.stringify(" + expression + ")")).nextValue());
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
        assertEquals(script, "true", evaluate(view, script));
    }
}
