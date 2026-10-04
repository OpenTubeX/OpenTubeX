package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class FullscreenSystemBarsTest {
    @Test
    public void pageScrollbarsStayHiddenUntilFullscreenAndPictureInPictureBothExit() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                android.webkit.WebView view = activity.getBridge().getWebView();
                AndroidUiPlugin plugin = (AndroidUiPlugin) activity.getBridge().getPlugin("AndroidUi").getInstance();
                // Preserve asymmetric scrollbar defaults, rather than enabling
                // both axes blindly when the presentation modes finish.
                view.setVerticalScrollBarEnabled(true);
                view.setHorizontalScrollBarEnabled(false);
                setScrollbarsHidden(plugin, true);
                assertFalse(view.isVerticalScrollBarEnabled());
                assertFalse(view.isHorizontalScrollBarEnabled());
                plugin.onPictureInPictureModeChanged(true, () -> {});
                setScrollbarsHidden(plugin, false);
                assertFalse("PiP still owns suppression", view.isVerticalScrollBarEnabled());
                plugin.onPictureInPictureModeChanged(false, () -> {});
                assertTrue(view.isVerticalScrollBarEnabled());
                assertFalse(view.isHorizontalScrollBarEnabled());

                plugin.onPictureInPictureModeChanged(true, () -> {});
                setScrollbarsHidden(plugin, true);
                plugin.onPictureInPictureModeChanged(false, () -> {});
                assertFalse("Fullscreen still owns suppression", view.isVerticalScrollBarEnabled());
                setScrollbarsHidden(plugin, false);
                assertTrue(view.isVerticalScrollBarEnabled());
                assertFalse(view.isHorizontalScrollBarEnabled());
            });
        }
    }

    private static void setScrollbarsHidden(AndroidUiPlugin plugin, boolean hidden) {
        plugin.setPageScrollbarsHidden(new PluginCall(null, "AndroidUi", "test", "setPageScrollbarsHidden",
            new JSObject().put("hidden", hidden)) {
            @Override public void resolve() { }
        });
    }

    @Test
    public void systemBarsUseDefaultSwipeBehavior() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> assertEquals(
                WindowInsetsControllerCompat.BEHAVIOR_DEFAULT,
                WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView())
                    .getSystemBarsBehavior()
            ));
        }
    }
}
