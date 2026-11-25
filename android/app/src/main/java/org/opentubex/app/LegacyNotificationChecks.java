package org.opentubex.app;

import android.content.Context;

import androidx.work.WorkManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * What the native checks for comment replies and Twitch streams of earlier
 * versions left behind. The renderer checks both now, and takes over the
 * watched comments.
 */
final class LegacyNotificationChecks {
    private static final String COMMENT_REPLY_FILE = "comment-reply-threads.json";

    private LegacyNotificationChecks() {}

    /** The comments that earlier versions watched for replies. */
    static JSONArray readWatchedComments(Context context) throws IOException {
        File file = new File(context.getFilesDir(), COMMENT_REPLY_FILE);
        if (!file.exists()) return new JSONArray();
        try {
            JSONArray threads = new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8))
                .optJSONArray("threads");
            return threads == null ? new JSONArray() : threads;
        } catch (JSONException invalid) {
            return new JSONArray();
        }
    }

    /** Removes the earlier checks and their state, once the renderer keeps the watched comments. */
    static void clear(Context context) {
        WorkManager work = WorkManager.getInstance(context);
        work.cancelUniqueWork("comment-reply-checks");
        work.cancelUniqueWork("twitch-live-checks");
        new File(context.getFilesDir(), COMMENT_REPLY_FILE).delete();
        new File(context.getFilesDir(), "twitch-live-notifications.json").delete();
        context.deleteSharedPreferences("comment-replies");
        context.deleteSharedPreferences("twitch-live");
    }
}
