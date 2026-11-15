package org.opentubex.app;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Checks whether followed Twitch channels went live while the app is hidden or closed. */
public final class TwitchLiveWorker extends Worker {
    public TwitchLiveWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        // The visible app checks more often itself.
        if (AppVisibility.isVisible()) return Result.success();
        // The request goes through the app's proxy relay, whose kept-alive tunnels
        // the server may have closed while the app was frozen.
        AndroidProxy.closeStaleTunnels(AndroidProxyRelay.clock.getAsLong());
        try {
            TwitchLiveNotifications.check(getApplicationContext());
        } catch (Exception error) {
            // The next period checks again.
            Log.w("OpenTubeXTwitch", "Unable to check the live Twitch channels", error);
        }
        return Result.success();
    }
}
