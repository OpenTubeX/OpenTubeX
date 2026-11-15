package org.opentubex.app;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class BackgroundSyncTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    private WorkInfo.State periodicState() throws Exception {
        List<WorkInfo> infos = WorkManager.getInstance(context).getWorkInfosForUniqueWork("background-sync").get();
        return infos.isEmpty() ? null : infos.get(infos.size() - 1).getState();
    }

    @Test
    public void aProcessWithoutARendererPausesPeriodicSyncUntilARendererLoads() throws Exception {
        try {
            BackgroundSyncWorker.schedule(context, true);
            assertEquals(WorkInfo.State.ENQUEUED, periodicState());

            assertTrue("no renderer runs in the test process", BackgroundSyncPlugin.pauseWithoutRenderer(context));
            assertEquals("a process that cannot sync stops waking up for it", WorkInfo.State.CANCELLED, periodicState());

            try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
                assertEquals("the next renderer restores the job without waiting for the sync server",
                    WorkInfo.State.ENQUEUED, periodicState());
                assertFalse("a running renderer keeps the job", BackgroundSyncPlugin.pauseWithoutRenderer(context));
            }

            BackgroundSyncWorker.schedule(context, false);
            BackgroundSyncWorker.resume(context);
            assertEquals("disabled sync stays off", WorkInfo.State.CANCELLED, periodicState());
        } finally {
            BackgroundSyncWorker.schedule(context, false);
        }
    }
}
