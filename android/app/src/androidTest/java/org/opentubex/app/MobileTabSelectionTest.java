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
    public void nativeHeaderPreservesHistoryControlsInAutoLandscapeAndForcedTabletMode() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            await(view, "!!document.querySelector('.topNav') && " + STORE + ".getters.getActiveTab?.loadState === 'loaded'");
            await(view, "localStorage.getItem('opentubex.tutorial.audience') === 'completed' || " +
                "!!document.querySelector('.tutorialActions button')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            await(view, "!document.querySelector('.tutorialOverlay')");
            evaluate(view, "window.nativeHeaderOriginalSettings = { layout: " + STORE + ".getters.getCapacitorLayoutMode," +
                " scale: " + STORE + ".getters.getUiScale, hideSearch: " + STORE + ".getters.getHideSearchBar };" +
                STORE + ".commit('setUiScale', 100);" + STORE + ".commit('setHideSearchBar', false);" +
                STORE + ".commit('setCapacitorLayoutMode', 'auto')");
            try {
                scenario.onActivity(activity -> activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
                await(view, "innerWidth >= 768 && innerHeight <= 600 && document.querySelector('.app').classList.contains('capacitorTabletLayout')");
                assertTabletHeaderHistoryControls(view, "Auto landscape");
                evaluate(view, STORE + ".commit('setCapacitorLayoutMode', 'phone')");
                await(view, "document.querySelector('.app').classList.contains('capacitorPhoneLayout')");
                assertEquals("Forced Phone mode uses the tab overview in landscape", "true", evaluate(view,
                    "document.querySelector('.topNav').classList.contains('phoneLayout') && " +
                    "document.querySelector('.capacitorPhoneTabSwitcherButton').getBoundingClientRect().width > 0"));
                scenario.onActivity(activity -> activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
                await(view, "innerWidth < 768 && innerWidth < innerHeight");
                evaluate(view, STORE + ".commit('setCapacitorLayoutMode', 'tablet')");
                await(view, "document.querySelector('.app').classList.contains('capacitorTabletLayout')");
                assertTabletHeaderHistoryControls(view, "Forced Tablet portrait");
                evaluate(view, STORE + ".commit('setCapacitorLayoutMode', 'auto')");
                await(view, "document.querySelector('.app').classList.contains('capacitorPhoneLayout')");
                assertEquals("Auto portrait returns to the tab overview", "true", evaluate(view,
                    "document.querySelector('.topNav').classList.contains('phoneLayout') && " +
                    "document.querySelector('.capacitorPhoneTabSwitcherButton').getBoundingClientRect().width > 0"));
            } finally {
                evaluate(view, STORE + ".commit('setCapacitorLayoutMode', window.nativeHeaderOriginalSettings.layout);" +
                    STORE + ".commit('setUiScale', window.nativeHeaderOriginalSettings.scale);" +
                    STORE + ".commit('setHideSearchBar', window.nativeHeaderOriginalSettings.hideSearch);" +
                    "delete window.nativeHeaderOriginalSettings");
                scenario.onActivity(activity -> activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED));
            }
        }
    }

    private static void assertTabletHeaderHistoryControls(WebView view, String layout) throws Exception {
        assertEquals(layout + " retains navigation history controls beside the tablet tabs", "true", evaluate(view, """
            (() => {
                const header = document.querySelector('.topNav');
                return !header.classList.contains('phoneLayout') &&
                    header.querySelector('.navBackButton').getBoundingClientRect().width > 0 &&
                    header.querySelector('.navForwardButton').getBoundingClientRect().width > 0 &&
                    header.querySelector('.searchContainer').getBoundingClientRect().width > 0;
            })()
            """));
    }

    @Test
    public void brandHeaderReplacesItsRowWithSearchAndKeepsHistoryInTheTabOverview() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            await(view, "!!document.querySelector('.capacitorPhoneTabSwitcherButton') && " +
                STORE + ".getters.getActiveTab?.loadState === 'loaded'");
            await(view, "localStorage.getItem('opentubex.tutorial.audience') === 'completed' || " +
                "!!document.querySelector('.tutorialActions button')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            await(view, "!document.querySelector('.tutorialOverlay')");
            evaluate(view, """
                (() => {
                    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                    const keys = ['UiScale', 'CapacitorLayoutMode', 'HideHeaderLogo', 'HideSearchBar',
                        'MoveDownloadsToAppHeader', 'MoveSettingsToAppHeader', 'EnableSearchSuggestions', 'AlwaysShowMobileSearchBar'];
                    window.mobileHeaderSettings = Object.fromEntries(keys.map(key => [key, store.getters['get' + key]]));
                    window.mobileHeaderSearchHistory = [...store.getters.getSearchHistoryEntries];
                    store.commit('setCapacitorLayoutMode', 'phone');
                    for (const key of keys.slice(2)) store.commit('set' + key, false);
                    store.commit('setSearchHistoryEntries', [{ _id: 'header test', lastUpdatedAt: Date.now() }]);
                })()
                """);
            try {
                for (int scale : new int[] {100, 125}) {
                    evaluate(view, STORE + ".commit('setUiScale', " + scale + ")");
                    await(view, "document.querySelector('.topNav').classList.contains('phoneLayout')");
                    assertEquals("The brand replaces desktop navigation at scale " + scale, "true", evaluate(view, """
                        (() => {
                            const header = document.querySelector('.topNav');
                            return getComputedStyle(header.querySelector('.navBackButton')).display === 'none' &&
                                getComputedStyle(header.querySelector('.navForwardButton')).display === 'none' &&
                                header.querySelector('.logoText').getBoundingClientRect().width > 40;
                        })()
                        """));
                    evaluate(view, "window.mobileHeaderHistoryIndex = " + STORE + ".getters.getActiveTab.historyIndex;" +
                        "document.querySelector('.navSearchButton').click()");
                    await(view, "document.activeElement === document.querySelector('.topNav .ft-input')");
                    evaluate(view, "(() => { const input = document.querySelector('.topNav .ft-input');" +
                        "input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
                    await(view, "document.querySelector('.topNav .list')?.textContent.includes('header test')");
                    assertEquals("Suggestions span the entire search bar at scale " + scale, "true", evaluate(view, """
                        (() => {
                            const search = document.querySelector('.searchContainer').getBoundingClientRect();
                            const list = document.querySelector('.topNav .list').getBoundingClientRect();
                            return Math.abs(search.left - list.left) < 0.1 &&
                                Math.abs(search.right - list.right) < 0.1 &&
                                Math.abs(search.bottom - list.top) < 0.1;
                        })()
                        """));
                    assertEquals("Search stays in the header with equal gutters", "true", evaluate(view, """
                        (() => {
                            const header = document.querySelector('.topNav').getBoundingClientRect();
                            const search = document.querySelector('.searchContainer').getBoundingClientRect();
                            return search.top >= header.top && search.bottom <= header.bottom &&
                                Math.abs((search.left - header.left) - (header.right - search.right)) < 0.1;
                        })()
                        """));
                    scenario.onActivity(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                    await(view, "!document.querySelector('.topNav').classList.contains('phoneSearchOpen')");
                    assertEquals("Android Back closes search before navigating", "true", evaluate(view,
                        STORE + ".getters.getActiveTab.historyIndex === window.mobileHeaderHistoryIndex"));
                }
                evaluate(view, STORE + ".commit('setUiScale', 100);" + STORE + ".dispatch('showSettingsWindow')");
                await(view, "!!document.querySelector('.settingsMenu [data-section=\"appearance\"]')");
                evaluate(view, "document.querySelector('.settingsMenu [data-section=\"appearance\"]').click()");
                await(view, "!!document.querySelector('[data-setting-key=\"alwaysShowMobileSearchBar\"] .switch-label')");
                evaluate(view, "document.querySelector('[data-setting-key=\"alwaysShowMobileSearchBar\"] .switch-label').click()");
                await(view, STORE + ".getters.getAlwaysShowMobileSearchBar === true");
                evaluate(view, STORE + ".dispatch('hideSettingsWindow')");
                await(view, "!document.querySelector('.settingsWindow')");
                for (int scale : new int[] {100, 125}) {
                    evaluate(view, STORE + ".commit('setUiScale', " + scale + ")");
                    await(view, "!!document.querySelector('.pinnedSearchTrigger')");
                    assertEquals("The visible search pill leaves tabs accessible at scale " + scale, "true", evaluate(view, """
                        (() => {
                            const pill = document.querySelector('.pinnedSearchTrigger').getBoundingClientRect();
                            const tabs = document.querySelector('.capacitorPhoneTabSwitcherButton').getBoundingClientRect();
                            return pill.width >= 48 && pill.height >= 48 && pill.left >= 0 && pill.right <= tabs.left;
                        })()
                        """));
                    evaluate(view, "document.querySelector('.pinnedSearchTrigger').click()");
                    await(view, "document.activeElement === document.querySelector('.topNav .ft-input')");
                    scenario.onActivity(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                    await(view, "!!document.querySelector('.pinnedSearchTrigger') && " +
                        "!document.querySelector('.topNav').classList.contains('phoneSearchOpen')");
                }
                scenario.onActivity(activity -> activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
                await(view, "innerWidth > innerHeight && !!document.querySelector('.pinnedSearchTrigger')");
                evaluate(view, "document.querySelector('.pinnedSearchTrigger').click()");
                await(view, "document.activeElement === document.querySelector('.topNav .ft-input')");
                scenario.onActivity(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                await(view, "!!document.querySelector('.pinnedSearchTrigger')");
                scenario.onActivity(activity -> activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
                await(view, "innerWidth < innerHeight");
                evaluate(view, STORE + ".commit('setAlwaysShowMobileSearchBar', false);" + STORE + ".commit('setUiScale', 100);" +
                    "document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/history')");
                await(view, "location.hash.includes('/history')");
                evaluate(view, "document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/userplaylists')");
                await(view, "location.hash.includes('/userplaylists')");
                evaluate(view, "document.querySelector('.capacitorPhoneTabSwitcherButton').click()");
                await(view, "!!document.querySelector('.capacitorPhoneTabHistoryButton')");
                evaluate(view, "document.querySelector('.capacitorPhoneTabHistoryButton').click()");
                await(view, "!!document.querySelector('.capacitorPhoneTabHistoryEntry[aria-current=\"page\"]')");
                scenario.onActivity(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
                await(view, "!!document.querySelector('.capacitorPhoneOpenTabs')");
                evaluate(view, "document.querySelector('.capacitorPhoneTabHistoryButton').click()");
                await(view, "!!document.querySelector('.capacitorPhoneTabHistoryEntry')");
                evaluate(view, "document.querySelector('.capacitorPhoneTabHistoryEntry').click()");
                await(view, STORE + ".getters.getActiveTab.historyIndex === 0 && !document.querySelector('.capacitorPhoneTabDialog')");
                evaluate(view, "document.querySelector('.capacitorPhoneTabSwitcherButton').click()");
                await(view, "!!document.querySelector('.capacitorPhoneTabHistoryButton')");
                evaluate(view, "document.querySelector('.capacitorPhoneTabHistoryButton').click()");
                await(view, "!!document.querySelector('.capacitorPhoneTabHistoryEntry:last-child')");
                evaluate(view, "document.querySelector('.capacitorPhoneTabHistoryEntry:last-child').click()");
                await(view, "location.hash.includes('/userplaylists') && !document.querySelector('.capacitorPhoneTabDialog')");
                scenario.onActivity(activity -> activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
                await(view, "innerWidth > innerHeight");
                evaluate(view, "document.querySelector('.navSearchButton').click()");
                await(view, "document.querySelector('.topNav').classList.contains('phoneSearchOpen')");
                assertEquals("Landscape search also replaces the header row", "true", evaluate(view,
                    "getComputedStyle(document.querySelector('.topNav .profiles')).display === 'none'"));
            } finally {
                evaluate(view, "document.querySelector('.closeMobileSearch')?.click();" +
                    STORE + ".dispatch('hideSettingsWindow');" +
                    "for (const [key, value] of Object.entries(window.mobileHeaderSettings)) " + STORE + ".commit('set' + key, value);" +
                    "window.mobileHeaderSettingsRestored = false;" +
                    STORE + ".dispatch('updateAlwaysShowMobileSearchBar', window.mobileHeaderSettings.AlwaysShowMobileSearchBar)" +
                    ".then(() => { window.mobileHeaderSettingsRestored = true });" +
                    STORE + ".commit('setSearchHistoryEntries', window.mobileHeaderSearchHistory);" +
                    "delete window.mobileHeaderSearchHistory; delete window.mobileHeaderSettings; delete window.mobileHeaderHistoryIndex");
                await(view, "window.mobileHeaderSettingsRestored === true");
                evaluate(view, "delete window.mobileHeaderSettingsRestored");
                scenario.onActivity(activity -> activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED));
            }
        }
    }

    @Test
    public void loadingDotAppearsInPhoneOrganizerAndTabletTabs() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            await(view, "!!document.querySelector('.capacitorPhoneTabSwitcherButton') && " +
                STORE + ".getters.getActiveTab?.loadState === 'loaded'");
            await(view, "localStorage.getItem('opentubex.tutorial.audience') === 'completed' || " +
                "!!document.querySelector('.tutorialActions button')");
            evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
            await(view, "!document.querySelector('.tutorialOverlay')");
            evaluate(view, "window.loadingDotOriginalLayout = " + STORE + ".getters.getCapacitorLayoutMode");
            try {
                for (String layout : new String[] {"phone", "tablet"}) {
                    evaluate(view, STORE + ".commit('setCapacitorLayoutMode', '" + layout + "')");
                    if (layout.equals("phone")) {
                        evaluate(view, "document.querySelector('.capacitorPhoneTabSwitcherButton').click()");
                    }
                    String row = layout.equals("phone") ? ".capacitorPhoneTabRow" : ".capacitorTabletTab";
                    await(view, "!!document.querySelector('" + row + "')");
                    evaluate(view, """
                        (() => {
                            const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                            window.loadingDotOriginalState = { ...store.state.tabs, tabs: store.state.tabs.tabs.map(tab => ({ ...tab })) };
                            store.commit('setTabsState', {
                                ...store.state.tabs,
                                tabs: store.state.tabs.tabs.map((tab, index) => index === 0 ? { ...tab, isLoading: true } : tab)
                            });
                        })();
                        """);
                    await(view, "!!document.querySelector('" + row + " .tabLoadingDot')");
                    assertEquals("Loading dot follows the motion preference in " + layout + " layout", "true",
                        evaluate(view, "(() => { const dot = document.querySelector('" + row +
                            " .tabLoadingDot'); const style = getComputedStyle(dot);" +
                            "const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches || " +
                            "document.documentElement.getAttribute('data-reduced-motion') === 'reduce';" +
                            "return style.display !== 'none' && style.width === '6px' && " +
                            "(reducedMotion ? style.animationName === 'none' : style.animationName !== 'none'); })()"));
                    evaluate(view, STORE + ".commit('setTabsState', window.loadingDotOriginalState)");
                    await(view, "!document.querySelector('" + row + " .tabLoadingDot')");
                    if (layout.equals("phone")) {
                        evaluate(view, "document.querySelector('.capacitorPhoneTabHeaderButton:last-of-type').click()");
                    }
                }
            } finally {
                evaluate(view, "if (window.loadingDotOriginalState) " + STORE +
                    ".commit('setTabsState', window.loadingDotOriginalState);" +
                    STORE + ".commit('setCapacitorLayoutMode', window.loadingDotOriginalLayout);" +
                    "delete window.loadingDotOriginalState; delete window.loadingDotOriginalLayout");
            }
        }
    }

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

                float x = emptyHeaderSwipeX(view);
                float y = Float.parseFloat(evaluate(view, "(() => { const r = document.querySelector('.topNav').getBoundingClientRect(); return (r.top + r.bottom) / 2 })()"));
                float scale = view.getWidth() / Float.parseFloat(evaluate(view, "window.innerWidth"));
                long downTime = SystemClock.uptimeMillis();
                touch(view, downTime, MotionEvent.ACTION_DOWN, x * scale, y * scale);
                touch(view, downTime, MotionEvent.ACTION_MOVE, (x + 80) * scale, y * scale);
                touch(view, downTime, MotionEvent.ACTION_UP, (x + 80) * scale, y * scale);
                await(view, STORE + ".getters.getActiveTabId === window.pageSwipeFirstId && " +
                    "!document.querySelector('.pageSwipeTo')");
                assertEquals("A fast release animates both pages before selecting the neighboring tab", "true",
                    evaluate(view, "window.pageSwipeTransitions.includes('transitionrun:left:from') && " +
                        "window.pageSwipeTransitions.includes('transitionrun:left:to')"));

                evaluate(view, "window.pageSwipeTransitions = []");
                downTime = SystemClock.uptimeMillis();
                touch(view, downTime, MotionEvent.ACTION_DOWN, x * scale, y * scale);
                touch(view, downTime, MotionEvent.ACTION_MOVE, (x - 80) * scale, y * scale);
                await(view, "!!document.querySelector('.pageSwipeTo')");
                touch(view, downTime, MotionEvent.ACTION_CANCEL, (x - 80) * scale, y * scale);
                await(view, "!document.querySelector('.pageSwipeTo')");
                assertEquals("A cancelled drag animates back to the original tab", "true",
                    evaluate(view, "window.pageSwipeTransitions.includes('transitionrun:left:from') && " +
                        "window.pageSwipeTransitions.includes('transitionrun:left:to') && " +
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

            float x = emptyHeaderSwipeX(view);
            float y = Float.parseFloat(evaluate(view, "(() => { const r = document.querySelector('.topNav').getBoundingClientRect(); return (r.top + r.bottom) / 2 })()"));
            float scale = view.getWidth() / Float.parseFloat(evaluate(view, "window.innerWidth"));
            float distance = Math.min(150, (view.getWidth() / scale) - x - 20);
            assertTrue("App bar has enough empty space for a swipe", distance > 80);
            evaluate(view, "document.querySelector('.app > .routerView').style.direction = 'rtl'");
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

            evaluate(view, "document.querySelector('.capacitorTabletNewTab').click()");
            await(view, STORE + ".getters.getActiveTab?.loadState === 'loaded' && " +
                STORE + ".getters.getActiveTabId === " + STORE + ".getters.getPresentedTabId && " +
                STORE + ".getters.getActiveTabId !== window.pageSwipeFirstId && " +
                STORE + ".getters.getActiveTabId !== window.pageSwipeSecondId");
            evaluate(view, "window.pageSwipeThirdId = " + STORE + ".getters.getActiveTabId");
            evaluate(view, "document.querySelector('.capacitorTabletTabTarget[data-tab-id=\"' + " +
                "window.pageSwipeSecondId + '\"]').click()");
            await(view, STORE + ".getters.getPresentedTabId === window.pageSwipeSecondId && " +
                STORE + ".getters.getActiveTabId === window.pageSwipeSecondId && " +
                "!!document.querySelector('.pageSwipePrewarm[data-tab-id=\"' + window.pageSwipeThirdId + '\"]')");
            downTime = SystemClock.uptimeMillis();
            touch(view, downTime, MotionEvent.ACTION_DOWN, x * scale, y * scale);
            touch(view, downTime, MotionEvent.ACTION_MOVE, (x + distance / 2) * scale, y * scale);
            await(view, "document.querySelector('.pageSwipeTo')?.dataset.tabId === String(window.pageSwipeFirstId)");
            assertEquals("The previous tab paints above the other prewarmed tab", "true",
                evaluate(view, """
                    (() => {
                        const target = document.querySelector('.pageSwipeTo');
                        const other = [...document.querySelectorAll('.pageSwipePrewarm')]
                            .find(page => page !== target);
                        const rect = target.getBoundingClientRect();
                        target.inert = false;
                        other.inert = false;
                        other.style.pointerEvents = 'auto';
                        try {
                            return document.elementFromPoint(rect.right - 30, rect.top + 30)
                                ?.closest('.tabContent') === target;
                        } finally {
                            target.inert = true;
                            other.inert = true;
                            other.style.pointerEvents = '';
                        }
                    })()
                    """));
            touch(view, downTime, MotionEvent.ACTION_CANCEL, (x + distance / 2) * scale, y * scale);
            await(view, "!document.querySelector('.pageSwipeTo')");
        }
    }

    private static float emptyHeaderSwipeX(WebView view) throws Exception {
        float x = Float.parseFloat(evaluate(view, """
            (() => {
                const header = document.querySelector('.topNav');
                const bounds = header.getBoundingClientRect();
                const left = header.querySelector('.logo')?.getBoundingClientRect().right ?? bounds.left;
                const right = header.querySelector('.profiles').getBoundingClientRect().left;
                const x = (left + right) / 2;
                const target = document.elementFromPoint(x, (bounds.top + bounds.bottom) / 2);
                return right > left && target && header.contains(target) &&
                    !target.closest('button, a, input, textarea, select, [role="button"], .searchContainer') ? x : -1;
            })()
            """));
        assertTrue("The swipe starts in visible empty header space", x >= 0);
        return x;
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
                                evaluate(view, String.format("""
                                    (() => {
                                        const app = document.querySelector('#app').__vue_app__.config.globalProperties;
                                        const count = document.querySelectorAll('%s input[type=checkbox]:checked').length;
                                        const label = app.$t('Context Menu.Close Multiple Tabs', { count }, count);
                                        [...document.querySelectorAll('.capacitorTabSelectionControls button')]
                                            .find(button => button.textContent.trim() === label).click();
                                    })()
                                    """, row));
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
