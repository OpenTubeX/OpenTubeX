package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.webkit.WebView;
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
    public void bulkCloseClampsPhoneAndTabletScrollbars() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            await(view, "!!document.querySelector('.profileTrigger')");
            await(view, "localStorage.getItem('opentubex.tutorial.audience') === 'completed' || !!document.querySelector('.tutorialActions button')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            await(view, "!document.querySelector('.tutorialOverlay')");
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
                                clickText(view, ".capacitorTabActions button", "Select Tab");
                                await(view, "!!document.querySelector('" + row + " input[type=checkbox]')");
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
                                clickText(view, ".capacitorTabActions button", "Close Tabs");
                                await(view, "!!document.querySelector('.capacitorTabActionHeader button')");
                                clickText(view, ".capacitorTabActions button", closeMode.equals("Other")
                                    ? "Close Other Tabs" : "Close Tabs " + closeMode);
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
                                evaluate(view, "document.querySelector('.capacitorPhoneTabHeader button[title=Close]').click()");
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
        evaluate(view, "[...document.querySelectorAll('" + selector + "')].find(button => button.textContent.trim() === '" + text + "').click()");
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
