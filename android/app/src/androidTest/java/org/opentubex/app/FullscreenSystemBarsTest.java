package org.opentubex.app;

import static org.junit.Assert.assertEquals;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class FullscreenSystemBarsTest {
    @Test
    public void swipedSystemBarsAreTransient() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> assertEquals(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE,
                WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView())
                    .getSystemBarsBehavior()
            ));
        }
    }
}
