package org.opentubex.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class SubscriptionRefreshCancelReceiver extends BroadcastReceiver {
    static final String ACTION_CANCEL = "org.opentubex.app.action.CANCEL_SUBSCRIPTION_REFRESH";
    static final String ACTION_CANCELLED = "org.opentubex.app.action.SUBSCRIPTION_REFRESH_CANCELLED";
    static final String TOKEN_EXTRA = "token";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_CANCEL.equals(intent.getAction())) return;
        String token = intent.getStringExtra(TOKEN_EXTRA);
        if (token == null) return;

        if (SubscriptionRefreshWorker.cancel(context, token)) {
            context.sendBroadcast(new Intent(ACTION_CANCELLED).setPackage(context.getPackageName()));
        }
    }
}
