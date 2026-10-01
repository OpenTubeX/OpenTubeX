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
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class MobileAppearanceSettingsTest {
    @Test
    public void performanceIndicatorsWrapWithoutSqueezingSwitchLabels() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            try {
                prepare(view);
                evaluate(view, """
                    (() => {
                        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                        window.__mobileAppearanceSaved.ShowPerformanceImpactIndicators = store.getters.getShowPerformanceImpactIndicators;
                        store.dispatch('showSettingsWindow');
                    })()
                    """);
                awaitCondition(view, "!!document.querySelector('.settingsMenu [data-section=general]')");
                evaluate(view, "document.querySelector('.settingsMenu [data-section=general]').click()");
                String control = "document.querySelector('.settingsContent [data-setting-key=updateRelativeTimestamps]')";
                awaitCondition(view, "!!" + control);
                for (int scale : new int[] {100, 125, 150}) {
                    evaluate(view, """
                        (() => {
                            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                            store.commit('setShowPerformanceImpactIndicators', false);
                            store.commit('setUiScale', %d);
                        })()
                        """.formatted(scale));
                    awaitCondition(view, "Math.abs(window.visualViewport.scale - " + scale / 100.0 + ") < 0.01 && !" +
                        control + ".querySelector('.performanceImpact')");
                    double originalWidth = json(view, "({width: " + control +
                        ".querySelector('.switch-label-text').getBoundingClientRect().width})").getDouble("width");
                    evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setShowPerformanceImpactIndicators', true)");
                    awaitCondition(view, "!!" + control + ".querySelector('.performanceImpact')");
                    JSONObject layout = json(view, """
                        (() => {
                            const element = %s;
                            const text = element.querySelector('.switch-label-text');
                            const badge = element.querySelector('.performanceImpact');
                            const range = document.createRange();
                            range.selectNodeContents(text);
                            const textBottom = Math.max(...Array.from(range.getClientRects(), rect => rect.bottom));
                            const bounds = badge.getBoundingClientRect();
                            const label = text;
                            const knob = getComputedStyle(label, '::after');
                            const textBounds = text.getBoundingClientRect();
                            const knobCenter = label.getBoundingClientRect().top + parseFloat(knob.top) +
                                new DOMMatrix(knob.transform).m42 + parseFloat(knob.height) / 2;
                            return {switchCenterOffset: Math.abs(knobCenter - textBounds.top - textBounds.height / 2), width: text.getBoundingClientRect().width, textBottom,
                                badgeTop: bounds.top, badgeRight: bounds.right,
                                helpLeft: element.querySelector('.tooltip').getBoundingClientRect().left,
                                helpBottom: element.querySelector('.tooltip').getBoundingClientRect().bottom};
                        })()
                        """.formatted(control));
                    assertTrue("The label retains its width at " + scale + "%: " + layout,
                        layout.getDouble("width") >= originalWidth - 1);
                    assertTrue("The badge wraps below the text at " + scale + "%: " + layout,
                        layout.getDouble("badgeTop") >= layout.getDouble("textBottom") - 1);
                    assertTrue("The switch stays centered beside its text at " + scale + "%: " + layout,
                        layout.getDouble("switchCenterOffset") <= 1);
                    assertTrue("The badge does not overlap help at " + scale + "%: " + layout,
                        layout.getDouble("badgeRight") <= layout.getDouble("helpLeft") + 1 ||
                            layout.getDouble("badgeTop") >= layout.getDouble("helpBottom") - 1);
                }
            } finally {
                evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('setSettingsWindowOpen', false)");
                restore(view);
            }
        }
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
    public void enlargedPhoneHeaderKeepsBackAndBothShortcutsWithinViewport() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            try {
                prepare(view);
                evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/userplaylists')");
                awaitCondition(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$route.path === '/userplaylists'");
                awaitCondition(view, "!!document.querySelector('.topNav .downloadsButton') && !!document.querySelector('.topNav .settingsButton')");
                awaitCondition(view, """
                    (() => {
                        const viewport = window.visualViewport;
                        const visible = element => {
                            const rect = element.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0 &&
                                getComputedStyle(element).visibility !== 'hidden';
                        };
                        const back = document.querySelector('.navBackButton');
                        if (!back || !visible(back)) return false;
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
                String route = "document.querySelector('#app').__vue_app__.config.globalProperties.$route.fullPath";
                String backDisabled = "document.querySelector('.navBackButton button').getAttribute('aria-disabled') === 'true'";
                String expectedForwardRoute = null;
                for (int entry = 0; entry < 10 && !"true".equals(evaluate(view, backDisabled)); entry++) {
                    expectedForwardRoute = evaluate(view, route);
                    assertTrue("Back remains visible while navigating history", "true".equals(evaluate(view,
                        "document.querySelector('.navBackButton button').getBoundingClientRect().width > 0")));
                    evaluate(view, "document.querySelector('.navBackButton button').click()");
                    awaitCondition(view, route + " !== " + expectedForwardRoute + " || " + backDisabled);
                }
                assertEquals("Back is disabled at the earliest history entry", "true", evaluate(view, backDisabled));
                assertTrue("The fixture has a forward history entry", expectedForwardRoute != null);
                awaitCondition(view, """
                    (() => {
                        const forward = document.querySelector('.navForwardButton button');
                        const rect = forward.getBoundingClientRect();
                        const viewport = window.visualViewport;
                        return forward.getAttribute('aria-disabled') === 'false' && rect.width > 0 &&
                            rect.left >= viewport.offsetLeft - 1 &&
                            rect.right <= viewport.offsetLeft + viewport.width + 1;
                    })()
                    """);
                evaluate(view, "document.querySelector('.navForwardButton button').click()");
                awaitCondition(view, route + " === " + expectedForwardRoute);
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

    private static void prepare(WebView view) throws Exception {
        evaluate(view, """
            (() => {
                const app = document.querySelector('#app').__vue_app__.config.globalProperties;
                const values = {
                    UiScale: 150, CapacitorLayoutMode: 'phone', EnableDownloads: true,
                    MoveDownloadsToAppHeader: true, MoveSettingsToAppHeader: true,
                    HideHeaderLogo: false, AlwaysShowScrollbars: true,
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
