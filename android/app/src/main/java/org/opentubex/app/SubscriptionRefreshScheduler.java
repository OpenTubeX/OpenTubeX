package org.opentubex.app;

import android.content.Context;

import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

final class SubscriptionRefreshScheduler {
    private static final long MINIMUM_INTERVAL_MILLIS = TimeUnit.MINUTES.toMillis(15);
    private static final String SCHEDULE_TAG = "subscription-refresh-schedule";

    private SubscriptionRefreshScheduler() {}

    static void reconcile(Context context) {
        WorkManager workManager = WorkManager.getInstance(context);
        Set<String> wantedNames = new HashSet<>();
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();

        for (String feedType : SubscriptionRefreshConfiguration.FEED_TYPES) {
            List<SubscriptionRefreshConfiguration.Feed> feeds =
                SubscriptionRefreshConfiguration.findFeeds(context, feedType);
            if (feeds.isEmpty()) continue;
            SubscriptionRefreshConfiguration.Feed feed = feeds.get(0);
            String name = uniqueName(feedType);
            wantedNames.add(name);
            long interval = Math.max(MINIMUM_INTERVAL_MILLIS, feed.intervalMillis);
            Data input = new Data.Builder()
                .putString(SubscriptionRefreshWorker.FEED_TYPE_INPUT, feedType)
                .build();
            PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                SubscriptionRefreshWorker.class,
                interval,
                TimeUnit.MILLISECONDS
            )
                .setInputData(input)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.MINUTES)
                .addTag(SCHEDULE_TAG)
                .build();
            workManager.enqueueUniquePeriodicWork(name, ExistingPeriodicWorkPolicy.UPDATE, request);
        }

        SubscriptionRefreshScheduleNames.replace(context, wantedNames, workManager);
    }

    static String uniqueName(String type) {
        return "subscription-refresh-scheduled-" + type;
    }
}
