package org.opentubex.app;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * Checks the comments the YouTube account posted in the app for replies, while
 * the app is visible and, if it may refresh subscriptions then, while it is
 * hidden or closed.
 */
public final class CommentReplyWorker extends Worker {
    public CommentReplyWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        try {
            if (!AppVisibility.isVisible() && !CommentReplyNotifications.closedAppAllowed(context)) return Result.success();
            // The requests go through the app's proxy relay, whose kept-alive tunnels
            // the server may have closed while the app was frozen.
            AndroidProxy.closeStaleTunnels(AndroidProxyRelay.clock.getAsLong());
            CommentReplyNotifications.check(context);
        } catch (Exception error) {
            // The next period checks again.
            Log.w("OpenTubeXReplies", "Unable to check comments for replies", error);
        }
        return Result.success();
    }
}
