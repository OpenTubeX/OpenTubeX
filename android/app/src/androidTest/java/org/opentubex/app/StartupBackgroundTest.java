package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.content.Context;
import android.content.res.Configuration;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayInputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class StartupBackgroundTest {
    @Test
    public void launchDoesNotAddANativeActivityTitle() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            AtomicReference<String> title = new AtomicReference<>();
            scenario.onActivity(activity -> {
                reference.set(activity.getBridge().getWebView());
                title.set(activity.getTitle().toString());
            });
            awaitReady(reference.get());
            var automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
            var root = automation.getRootInActiveWindow();
            long deadline = android.os.SystemClock.uptimeMillis() + 5000;
            while (root == null && android.os.SystemClock.uptimeMillis() < deadline) {
                Thread.sleep(50);
                root = automation.getRootInActiveWindow();
            }
            assertTrue("The activity is visible", root != null);
            assertTrue("The app must not show a native activity title above its interface",
                root.findAccessibilityNodeInfosByText(title.get()).isEmpty());
        }
    }

    @Test
    public void launchWithoutSplashKeepsTheSelectedBackgroundBeforeRendererLoads() throws Exception {
        for (String[] appearance : new String[][] {
            {"dark", "#0f0f0f"}, {"light", "#f1f1f1"},
            {"openTubeXDark", "#0b1416"}, {"hotPink", "#dd197f"}
        }) {
            try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
                AtomicReference<WebView> reference = new AtomicReference<>();
                scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
                WebView view = reference.get();
                awaitReady(view);
                String store = "document.querySelector('#app').__vue_app__.config.globalProperties.$store";
                String originalTheme = evaluate(view, store + ".getters.getBaseTheme");
                String originalHideSplash = evaluate(view, store + ".getters.getHideStartupSplash");
                try {
                    evaluate(view, store + ".dispatch('updateHideStartupSplash', true)");
                    evaluate(view, store + ".dispatch('updateBaseTheme', '" + appearance[0] + "').then(() => window.__startupThemeSaved = true)");
                    awaitCondition(view, "window.__startupThemeSaved === true && document.body.classList.contains('" + appearance[0] + "')");
                    int expectedColor = Color.parseColor(appearance[1]);
                    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
                    long deadline = android.os.SystemClock.uptimeMillis() + 5000;
                    while (StartupBackground.getColor(context) != expectedColor && android.os.SystemClock.uptimeMillis() < deadline) {
                        Thread.sleep(50);
                    }
                    assertEquals("The selected theme reaches the native launch cache", expectedColor, StartupBackground.getColor(context));
                    // Recreate the native window, then hold the real packaged page at
                    // its pre-renderer state. No splash covers the measured surface.
                    scenario.recreate();
                    CountDownLatch rendererRequested = new CountDownLatch(1);
                    scenario.onActivity(activity -> {
                        WebView nextView = activity.getBridge().getWebView();
                        reference.set(nextView);
                        activity.getBridge().setWebViewClient(new OpenTubeXWebViewClient(activity.getBridge()) {
                            @Override
                            public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
                                if (request.getUrl().getPath().equals("/web.js")) {
                                    rendererRequested.countDown();
                                    return new WebResourceResponse("application/javascript", "UTF-8", new ByteArrayInputStream(new byte[0]));
                                }
                                return super.shouldInterceptRequest(webView, request);
                            }
                        });
                        nextView.stopLoading();
                        nextView.loadUrl("https://localhost/");
                    });
                    view = reference.get();
                    assertTrue("The real renderer request is intercepted", rendererRequested.await(10, TimeUnit.SECONDS));
                    awaitCondition(view, "!!document.querySelector('#app') && !document.querySelector('#app').__vue_app__ && !document.querySelector('#startup-splash')");
                    CountDownLatch painted = new CountDownLatch(1);
                    WebView pausedView = view;
                    scenario.onActivity(activity -> pausedView.postVisualStateCallback(1, new WebView.VisualStateCallback() {
                        @Override public void onComplete(long requestId) {
                            pausedView.postOnAnimation(() -> pausedView.postOnAnimation(painted::countDown));
                        }
                    }));
                    assertTrue("The startup page is painted", painted.await(5, TimeUnit.SECONDS));
                    Bitmap screenshot = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
                    assertEquals("The blank startup frame uses " + appearance[0] + ", without a white flash",
                        expectedColor, screenshot.getPixel(screenshot.getWidth() / 2, screenshot.getHeight() / 2));
                    screenshot.recycle();
                } finally {
                    // A reload leaves the previous document usable briefly.
                    // Wait for the replacement before restoring persisted settings.
                    evaluate(view, "window.__startupPreviousDocument = true");
                    scenario.onActivity(activity -> {
                        activity.getBridge().setWebViewClient(new OpenTubeXWebViewClient(activity.getBridge()));
                        activity.getBridge().getWebView().reload();
                    });
                    view = reference.get();
                    awaitCondition(view, "window.__startupPreviousDocument !== true");
                    awaitReady(view);
                    assertEquals("The loaded interface keeps the startup theme", "true",
                        evaluate(view, "document.body.classList.contains('" + appearance[0] + "')"));
                    evaluate(view, "Promise.all([" + store + ".dispatch('updateHideStartupSplash', " + originalHideSplash + "), " +
                        store + ".dispatch('updateBaseTheme', " + originalTheme + ")]).then(() => window.__startupThemeRestored = true)");
                    awaitCondition(view, "window.__startupThemeRestored === true");
                }
            }
        }
    }

    @Test
    public void startupColorsFollowSystemModeAndKeepFixedThemesAcrossModeChanges() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        var preferences = context.getSharedPreferences("startup-background", Context.MODE_PRIVATE);
        var original = preferences.getAll();
        try {
            preferences.edit().clear().commit();
            Configuration lightConfiguration = new Configuration(context.getResources().getConfiguration());
            lightConfiguration.uiMode = (lightConfiguration.uiMode & ~Configuration.UI_MODE_NIGHT_MASK) | Configuration.UI_MODE_NIGHT_NO;
            Configuration darkConfiguration = new Configuration(lightConfiguration);
            darkConfiguration.uiMode = (darkConfiguration.uiMode & ~Configuration.UI_MODE_NIGHT_MASK) | Configuration.UI_MODE_NIGHT_YES;
            Context light = context.createConfigurationContext(lightConfiguration);
            Context dark = context.createConfigurationContext(darkConfiguration);
            assertEquals("Fresh light launch", Color.rgb(241, 241, 241), StartupBackground.getColor(light));
            assertEquals("Fresh dark launch", Color.rgb(15, 15, 15), StartupBackground.getColor(dark));
            for (Context mode : new Context[] { light, dark }) {
                var launch = new android.view.ContextThemeWrapper(mode, R.style.AppTheme_NoActionBarLaunch);
                var colors = launch.obtainStyledAttributes(new int[] {
                    android.R.attr.windowBackground, androidx.core.splashscreen.R.attr.windowSplashScreenBackground
                });
                try {
                    int expected = mode.getColor(R.color.startup_background);
                    assertEquals("Legacy launch window follows the system theme", expected, colors.getColor(0, 0));
                    assertEquals("Android 12 launch window follows the system theme", expected, colors.getColor(1, 0));
                } finally {
                    colors.recycle();
                }
            }
            StartupBackground.save(light, Color.rgb(232, 242, 240), true);
            StartupBackground.save(dark, Color.rgb(11, 20, 22), true);
            assertEquals("Cached system light theme", Color.rgb(232, 242, 240), StartupBackground.getColor(light));
            assertEquals("Cached system dark theme", Color.rgb(11, 20, 22), StartupBackground.getColor(dark));
            StartupBackground.save(light, Color.rgb(255, 0, 138), false);
            assertEquals("Fixed theme in light mode", Color.rgb(255, 0, 138), StartupBackground.getColor(light));
            assertEquals("Fixed theme in dark mode", Color.rgb(255, 0, 138), StartupBackground.getColor(dark));
        } finally {
            var editor = preferences.edit().clear();
            for (var entry : original.entrySet()) {
                if (entry.getValue() instanceof Boolean value) editor.putBoolean(entry.getKey(), value);
                else if (entry.getValue() instanceof Integer value) editor.putInt(entry.getKey(), value);
            }
            editor.commit();
        }
    }

    private static void awaitReady(WebView view) throws Exception {
        awaitCondition(view, "!!document.querySelector('#app')?.__vue_app__ && !!document.querySelector('.topNav') && document.body.classList.length > 0");
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
