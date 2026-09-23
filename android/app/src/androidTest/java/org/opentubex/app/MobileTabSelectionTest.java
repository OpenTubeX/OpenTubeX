package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.webkit.WebView;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class MobileTabSelectionTest {
    private static final String STORE = "document.querySelector('#app').__vue_app__.config.globalProperties.$store";

    @Test
    public void fastAppBarSwipeAnimatesTheIncomingTabBeforeSelectionChanges() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            await(view, "!!document.querySelector('.capacitorTabletNewTab') && " +
                STORE + ".getters.getActiveTab?.loadState === 'loaded'");
            await(view, "localStorage.getItem('opentubex.tutorial.audience') === 'completed' || " +
                "!!document.querySelector('.tutorialActions button')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            await(view, "!document.querySelector('.tutorialOverlay')");
            evaluate(view, "window.pageSwipeFirstId = " + STORE + ".getters.getActiveTabId;" +
                "document.querySelector('.capacitorTabletNewTab').click()");
            await(view, STORE + ".getters.getActiveTab?.loadState === 'loaded' && " +
                STORE + ".getters.getActiveTabId !== window.pageSwipeFirstId");
            assertEquals("The loaded neighboring page is rendered behind the current page", "true",
                evaluate(view, "(() => { const neighbor = document.querySelector('.tabContent[data-tab-id=\"' + window.pageSwipeFirstId + '\"]');" +
                    "const viewport = document.querySelector('.app > .routerView').getBoundingClientRect();" +
                    "const rect = neighbor.getBoundingClientRect();" +
                    "return getComputedStyle(neighbor).display !== 'none' && rect.width === viewport.width &&" +
                    "rect.left === viewport.left && neighbor.inert && neighbor.getAttribute('aria-hidden') === 'true'; })()"));
            evaluate(view, "window.pageSwipeOriginalAnimationSpeed = " + STORE + ".getters.getAnimationSpeed;" +
                STORE + ".commit('setAnimationSpeed', 25)");
            try {
                evaluate(view, """
                window.pageSwipeTransitions = [];
                for (const type of ['transitionrun', 'transitionend', 'transitioncancel']) {
                    document.querySelector('.app > .routerView').addEventListener(type, event => {
                        if (event.target.classList.contains('tabContent')) {
                            window.pageSwipeTransitions.push(type + ':' + event.propertyName + ':' +
                                (event.target.dataset.tabId === String(window.pageSwipeFirstId) ? 'to' : 'from'));
                        }
                    });
                }
                """);

                float x = Float.parseFloat(evaluate(view, "(() => { const r = document.querySelector('.topNav .middle').getBoundingClientRect(); return (r.left + r.right) / 2 })()"));
                float y = Float.parseFloat(evaluate(view, "(() => { const r = document.querySelector('.topNav').getBoundingClientRect(); return (r.top + r.bottom) / 2 })()"));
                float scale = view.getWidth() / Float.parseFloat(evaluate(view, "window.innerWidth"));
                long downTime = SystemClock.uptimeMillis();
                touch(view, downTime, MotionEvent.ACTION_DOWN, x * scale, y * scale);
                touch(view, downTime, MotionEvent.ACTION_MOVE, (x + 80) * scale, y * scale);
                touch(view, downTime, MotionEvent.ACTION_UP, (x + 80) * scale, y * scale);
                await(view, STORE + ".getters.getActiveTabId === window.pageSwipeFirstId && " +
                    "!document.querySelector('.pageSwipeTo')");
                assertEquals("A fast release finishes both page slides before switching tabs", "true",
                    evaluate(view, "window.pageSwipeTransitions.includes('transitionend:left:from') && " +
                        "window.pageSwipeTransitions.includes('transitionend:left:to') && " +
                        "!window.pageSwipeTransitions.some(event => event.startsWith('transitioncancel:left'))"));

                evaluate(view, "window.pageSwipeTransitions = []");
                downTime = SystemClock.uptimeMillis();
                touch(view, downTime, MotionEvent.ACTION_DOWN, x * scale, y * scale);
                touch(view, downTime, MotionEvent.ACTION_MOVE, (x - 80) * scale, y * scale);
                await(view, "!!document.querySelector('.pageSwipeTo')");
                touch(view, downTime, MotionEvent.ACTION_CANCEL, (x - 80) * scale, y * scale);
                await(view, "!document.querySelector('.pageSwipeTo')");
                assertEquals("A cancelled drag slides back before the pages are hidden", "true",
                    evaluate(view, "window.pageSwipeTransitions.filter(event => event.startsWith('transitionend:left')).length === 2 && " +
                        STORE + ".getters.getActiveTabId === window.pageSwipeFirstId"));
            } finally {
                evaluate(view, STORE + ".commit('setAnimationSpeed', window.pageSwipeOriginalAnimationSpeed);" +
                    "delete window.pageSwipeOriginalAnimationSpeed");
            }
        }
    }

    @Test
    public void draggingEmptyAppBarSlidesBetweenLoadedTabs() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            await(view, "!!document.querySelector('.capacitorTabletNewTab') && " +
                STORE + ".getters.getActiveTab?.loadState === 'loaded'");
            await(view, "localStorage.getItem('opentubex.tutorial.audience') === 'completed' || " +
                "!!document.querySelector('.tutorialActions button')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            await(view, "!document.querySelector('.tutorialOverlay')");
            evaluate(view, "window.pageSwipeFirstId = " + STORE + ".getters.getActiveTabId;" +
                "document.querySelector('.capacitorTabletNewTab').click()");
            await(view, STORE + ".getters.getTabs.length >= 2 && " +
                STORE + ".getters.getActiveTab?.loadState === 'loaded' && " +
                STORE + ".getters.getActiveTabId === " + STORE + ".getters.getPresentedTabId && " +
                STORE + ".getters.getActiveTabId !== window.pageSwipeFirstId");
            evaluate(view, "window.pageSwipeSecondId = " + STORE + ".getters.getActiveTabId");

            float x = Float.parseFloat(evaluate(view, "(() => { const r = document.querySelector('.topNav .middle').getBoundingClientRect(); return (r.left + r.right) / 2 })()"));
            float y = Float.parseFloat(evaluate(view, "(() => { const r = document.querySelector('.topNav').getBoundingClientRect(); return (r.top + r.bottom) / 2 })()"));
            float scale = view.getWidth() / Float.parseFloat(evaluate(view, "window.innerWidth"));
            float distance = Math.min(150, (view.getWidth() / scale) - x - 20);
            assertTrue("App bar has enough empty space for a swipe", distance > 80);
            long downTime = SystemClock.uptimeMillis();
            touch(view, downTime, MotionEvent.ACTION_DOWN, x * scale, y * scale);
            touch(view, downTime, MotionEvent.ACTION_MOVE, (x + distance / 2) * scale, y * scale);
            await(view, "!!document.querySelector('.pageSwipeTo') && " +
                STORE + ".getters.getPresentedTabId !== window.pageSwipeFirstId");
            assertEquals("The neighboring page stays flush with the moving page", "true",
                evaluate(view, "Math.abs(document.querySelector('.pageSwipeTo').getBoundingClientRect().right - document.querySelector('.pageSwipeFrom').getBoundingClientRect().left) <= 1"));
            touch(view, downTime, MotionEvent.ACTION_MOVE, (x + distance) * scale, y * scale);
            touch(view, downTime, MotionEvent.ACTION_UP, (x + distance) * scale, y * scale);
            await(view, STORE + ".getters.getPresentedTabId === window.pageSwipeFirstId && " +
                STORE + ".getters.getActiveTabId === window.pageSwipeFirstId && " +
                "!document.querySelector('.pageSwipeTo')");
            float leftDistance = Math.min(150, x - 20);
            assertTrue("App bar has enough empty space in both directions", leftDistance > 80);
            downTime = SystemClock.uptimeMillis();
            touch(view, downTime, MotionEvent.ACTION_DOWN, x * scale, y * scale);
            touch(view, downTime, MotionEvent.ACTION_MOVE, (x - leftDistance) * scale, y * scale);
            touch(view, downTime, MotionEvent.ACTION_UP, (x - leftDistance) * scale, y * scale);
            await(view, STORE + ".getters.getPresentedTabId === window.pageSwipeSecondId && " +
                STORE + ".getters.getActiveTabId === window.pageSwipeSecondId && " +
                "!document.querySelector('.pageSwipeTo')");
        }
    }

    private static void touch(WebView view, long downTime, int action, float x, float y) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
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
            view.dispatchTouchEvent(event);
            event.recycle();
        });
    }

    @Test
    public void bulkCloseClampsPhoneAndTabletScrollbars() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            await(view, "!!document.querySelector('.profileTrigger')");
            await(view, "localStorage.getItem('opentubex.tutorial.audience') === 'completed' || !!document.querySelector('.tutorialActions button')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            await(view, "!document.querySelector('.tutorialOverlay')");
            assertEquals("Run in a fresh temporary app profile", "true", evaluate(view, String.format("""
                %s.getters.getTabs.length === 1 && !%s.getters.getTabs[0].isPinned &&
                %s.getters.getTabs[0].route.path === '/' + %s.getters.getLandingPage &&
                %s.getters.getClosedTabs.length === 0
                """, STORE, STORE, STORE, STORE, STORE)));
            evaluate(view, String.format("""
                window.mobileTabsSaved = {
                    scale: %s.getters.getUiScale,
                    layout: %s.getters.getCapacitorLayoutMode,
                    scrollbars: %s.getters.getAlwaysShowScrollbars
                };
                %s.commit('setAlwaysShowScrollbars', true);
                """, STORE, STORE, STORE, STORE));
            try {
                for (String layout : new String[] {"phone", "tablet"}) {
                    for (int scale : new int[] {100, 95}) {
                        for (String closeMode : new String[] {"selected", "Before", "After", "Other"}) {
                            evaluate(view, STORE + ".commit('setCapacitorLayoutMode', '" + layout + "');" +
                                STORE + ".commit('setUiScale', " + scale + ")");
                            String prefix = layout.equals("phone") ? "capacitorPhone" : "capacitorTablet";
                            String row = "." + prefix + (layout.equals("phone") ? "TabRow" : "Tab");
                            String viewport = layout.equals("phone")
                                ? "#capacitor-phone-open-tabs-panel" : ".capacitorTabletTabsViewport";
                            String content = layout.equals("phone") ? ".capacitorPhoneOpenTabs" : ".capacitorTabletTabs";
                            String component = layout.equals("phone") ? ".capacitorPhoneTabSwitcher" : ".capacitorTabletTabBar";
                            await(view, "!!document.querySelector('" + component + "')");
                            evaluate(view, """
                                window.mobileTabsSeeded = false;
                                (async () => {
                                    const app = document.querySelector('#app').__vue_app__.config.globalProperties;

                                    for (let i = 0; i < 16; i++) {
                                        const count = app.$store.getters.getTabs.length;
                                        document.querySelector('.capacitorTabletNewTab').click();
                                        while (app.$store.getters.getTabs.length === count ||
                                            app.$store.getters.getActiveTabId !== app.$store.getters.getPresentedTabId ||
                                            app.$store.getters.getActiveTab.loadState !== 'loaded') {
                                            await new Promise(resolve => setTimeout(resolve, 20));
                                        }
                                    }
                                    window.mobileTabsOriginalIds = app.$store.getters.getTabs.map(tab => tab.id);
                                    window.mobileTabsSeeded = true;
                                })();
                                """);
                            await(view, "window.mobileTabsSeeded === true");
                            if (layout.equals("phone")) {
                                evaluate(view, "document.querySelector('.capacitorPhoneTabSwitcherButton').click()");
                            }
                            await(view, "document.querySelectorAll('" + row + "').length >= 17");
                            if (closeMode.equals("selected")) {
                                evaluate(view, "document.querySelector('" + row + "').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))");
                                await(view, "!!document.querySelector('.capacitorTabActions')");
                                clickText(view, ".capacitorTabActions button", "Context Menu.Select Tab");
                                await(view, "!!document.querySelector('" + row + " input[type=checkbox]')");
                                await(view, "document.activeElement === document.querySelector('" + row + " [data-tab-id]')");
                                evaluate(view, String.format("""
                                    document.querySelectorAll('%s input[type=checkbox]').forEach(input => {
                                        if (!input.checked) input.click();
                                    });
                                    """, row));
                            }
                            String axis = layout.equals("phone") ? "Top" : "Left";
                            String dimension = layout.equals("phone") ? "Height" : "Width";
                            evaluate(view, "document.querySelector('" + viewport + "').scroll" + axis +
                                " = document.querySelector('" + viewport + "').scroll" + dimension);
                            await(view, "document.querySelector('" + viewport + "').scroll" + axis + " > 20");
                            if (closeMode.equals("selected")) {
                                evaluate(view, "document.querySelector('.capacitorTabSelectionControls button').click()");
                            } else {
                                String target = closeMode.equals("Before") ? ".at(-1)" : "[0]";
                                evaluate(view, "[...document.querySelectorAll('" + row + "')]" + target +
                                    ".dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))");
                                await(view, "!!document.querySelector('.capacitorTabActions')");
                                clickText(view, ".capacitorTabActions button", "Context Menu.Close Tabs");
                                await(view, "!!document.querySelector('.capacitorTabActionHeader button')");
                                clickText(view, ".capacitorTabActions button", closeMode.equals("Other")
                                    ? "Context Menu.Close Other Tabs" : "Context Menu.Close Tabs " + closeMode);
                            }
                            await(view, "document.querySelectorAll('" + row + "').length === 1");
                            await(view, "!document.querySelector('.capacitorTabSelectionControls')");
                            if (closeMode.equals("selected")) {
                                assertEquals("Every selected tab was removed, leaving the landing page", "true",
                                    evaluate(view, "!window.mobileTabsOriginalIds.includes(" + STORE + ".getters.getTabs[0].id)"));
                            }
                            String scrollbar = layout.equals("phone") ? ".os-scrollbar-vertical" : ".os-scrollbar-horizontal";
                            await(view, String.format("""
                                (() => {
                                    const viewport = document.querySelector('%s');
                                    const content = viewport.querySelector('%s');
                                    const bar = viewport.querySelector('%s');
                                    return viewport.scroll%s <= 1 && content.getBoundingClientRect().%s <= viewport.client%s + 1 &&
                                        bar.classList.contains('os-scrollbar-unusable');
                                })()
                                """, viewport, content, scrollbar, axis,
                                    dimension.toLowerCase(), dimension));
                            if (layout.equals("phone")) {
                                evaluate(view, "[...document.querySelectorAll('.capacitorPhoneTabHeader button')].find(button => button.title === document.querySelector('#app').__vue_app__.config.globalProperties.$t('Close')).click()");
                                await(view, "!document.querySelector('.capacitorPhoneTabDialog')");
                            }
                        }
                    }
                }
            } finally {
                evaluate(view, String.format("""
                    %s.commit('setUiScale', window.mobileTabsSaved.scale);
                    %s.commit('setCapacitorLayoutMode', window.mobileTabsSaved.layout);
                    %s.commit('setAlwaysShowScrollbars', window.mobileTabsSaved.scrollbars);
                    delete window.mobileTabsSaved;
                    delete window.mobileTabsSeeded;
                    delete window.mobileTabsOriginalIds;
                    """, STORE, STORE, STORE));
            }
        }
    }

    private static void clickText(WebView view, String selector, String text) throws Exception {
        evaluate(view, "[...document.querySelectorAll('" + selector + "')].find(button => button.textContent.trim() === document.querySelector('#app').__vue_app__.config.globalProperties.$t('" + text + "')).click()");
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            latch.countDown();
        }));
        assertTrue("JavaScript responds", latch.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private static void await(WebView view, String script) throws Exception {
        long deadline = android.os.SystemClock.uptimeMillis() + 15000;
        while (android.os.SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(view, script))) return;
            Thread.sleep(100);
        }
        assertEquals(script + " DOM: " + evaluate(view, "document.body.innerText") +
            " tabs: " + evaluate(view, STORE + ".getters.getTabs.length"), "true", evaluate(view, script));
    }
}
