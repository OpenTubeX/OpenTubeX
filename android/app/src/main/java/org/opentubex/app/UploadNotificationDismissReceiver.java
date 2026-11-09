package org.opentubex.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Marks the entry of an upload notification the user dismissed read. */
public final class UploadNotificationDismissReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        UploadNotifications.recordDismissed(context, intent);
    }
}
