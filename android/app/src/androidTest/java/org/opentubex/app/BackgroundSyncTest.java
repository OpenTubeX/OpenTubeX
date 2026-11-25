package org.opentubex.app;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class BackgroundSyncTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test
    public void aClosedAppSyncsInAHiddenRendererThatGivesWayToTheApp() throws Exception {
        assertFalse("no renderer runs in the test process", BackgroundSyncPlugin.hasRenderer());
        // Capacitor's bridge expects an activity. A worker has none, so a stand-in
        // must load the page and let it report back without crashing the process.
        assertTrue("the hidden renderer reports the end of its sync",
            BackgroundSyncRenderer.sync(context, TimeUnit.MINUTES.toMillis(2), () -> false));
        assertFalse("the hidden renderer is not the app's", BackgroundSyncPlugin.hasRenderer());

        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            assertTrue(BackgroundSyncPlugin.hasRenderer());
            assertFalse("the app's renderer syncs by itself",
                BackgroundSyncRenderer.sync(context, TimeUnit.MINUTES.toMillis(2), () -> false));
        }
    }
}
