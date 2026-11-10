package org.opentubex.app;

import static org.junit.Assert.assertNotNull;

import android.app.Activity;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Recreates a scenario's activity and keeps following it. On a slow emulator,
 * ActivityScenario.recreate can lose track of the relaunched instance, whose
 * intent then no longer matches the one the scenario started.
 */
final class ActivityRecreation<T extends Activity> {
    private final ActivityScenario<T> scenario;
    private final Class<T> type;
    private T current;

    ActivityRecreation(ActivityScenario<T> scenario, Class<T> type) {
        this.scenario = scenario;
        this.type = type;
    }

    void recreate() throws InterruptedException {
        AtomicReference<T> previous = new AtomicReference<>();
        onActivity(activity -> {
            previous.set(activity);
            activity.recreate();
        });
        AtomicReference<T> next = new AtomicReference<>();
        long deadline = SystemClock.uptimeMillis() + 30000;
        while (next.get() == null && SystemClock.uptimeMillis() < deadline) {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                for (Activity activity : ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)) {
                    if (type.isInstance(activity) && activity != previous.get()) next.set(type.cast(activity));
                }
            });
            if (next.get() == null) Thread.sleep(100);
        }
        assertNotNull("The recreated activity resumes", next.get());
        current = next.get();
    }

    void onActivity(ActivityScenario.ActivityAction<T> action) {
        T activity = current;
        if (activity == null) scenario.onActivity(action);
        else InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> action.perform(activity));
    }

    /** Finishes a recreated activity the scenario may no longer close. */
    void finish() {
        T activity = current;
        if (activity != null) InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish);
    }
}
