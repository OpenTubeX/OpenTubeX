package org.opentubex.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.os.BatteryManager;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Runs once the requirement that automatic downloads are waiting for is met. */
public final class YtDlpDownloadConditionsWorker extends Worker {
    public YtDlpDownloadConditionsWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull @Override public Result doWork() {
        if (BuildConfig.BUNDLES_YT_DLP) YtDlpDownloads.get(getApplicationContext()).conditionsMet();
        return Result.success();
    }

    static YtDlpDownloads.Conditions conditions(Context context) {
        return new YtDlpDownloads.Conditions() {
            @Override public boolean unmetered() {
                ConnectivityManager connectivity = context.getSystemService(ConnectivityManager.class);
                return connectivity != null && connectivity.getActiveNetwork() != null && !connectivity.isActiveNetworkMetered();
            }

            @Override public boolean charging() {
                BatteryManager battery = context.getSystemService(BatteryManager.class);
                return battery != null && battery.isCharging();
            }

            @Override public void wakeWhen(boolean unmetered, boolean charging) {
                Constraints constraints = new Constraints.Builder()
                    .setRequiredNetworkType(unmetered ? NetworkType.UNMETERED : NetworkType.NOT_REQUIRED)
                    .setRequiresCharging(charging)
                    .build();
                WorkManager.getInstance(context).enqueueUniqueWork("yt-dlp-download-conditions", ExistingWorkPolicy.REPLACE,
                    new OneTimeWorkRequest.Builder(YtDlpDownloadConditionsWorker.class).setConstraints(constraints).build());
            }
        };
    }
}
