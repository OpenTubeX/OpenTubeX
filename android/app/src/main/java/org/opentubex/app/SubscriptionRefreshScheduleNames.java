package org.opentubex.app;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.work.WorkManager;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

final class SubscriptionRefreshScheduleNames {
    private static final String PREFERENCES = "subscription-refresh";
    private static final String NAMES_KEY = "schedule-names";

    private SubscriptionRefreshScheduleNames() {}

    static void replace(Context context, Set<String> wantedNames, WorkManager workManager) {
        SharedPreferences preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        Set<String> previousNames = preferences.getStringSet(NAMES_KEY, Collections.emptySet());
        for (String previousName : previousNames) {
            if (!wantedNames.contains(previousName)) workManager.cancelUniqueWork(previousName);
        }
        preferences.edit().putStringSet(NAMES_KEY, new HashSet<>(wantedNames)).commit();
    }
}
