package org.opentubex.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Android's single source of truth for new-upload notifications, shared by
 * foreground refreshes and scheduled refreshes. Mirrors src/newUploadNotifications.js.
 */
final class UploadNotifications {
    private static final String PREFERENCES = "upload-notifications";
    private static final String CONFIGURATION_KEY = "configuration";
    private static final String STATE_FILE = "upload-notifications.json";
    private static final String TAG = "new-upload";
    private static final int KNOWN_ID_LIMIT = 200;
    private static final int NOTIFIED_ID_LIMIT = 1000;
    // Feeds can surface older entries, for example when a video becomes public.
    private static final long MAXIMUM_AGE_MILLIS = 7L * 86_400_000L;

    private UploadNotifications() {}

    static synchronized void configure(Context context, JSONObject configuration) {
        preferences(context).edit().putString(CONFIGURATION_KEY, configuration.toString()).apply();
        // Start from a fresh baseline when notifications are enabled again.
        if (!configuration.optBoolean("enabled")) {
            stateFile(context).delete();
            return;
        }
        try {
            JSONObject state = readState(context);
            if (forgetUnconfiguredFeeds(state, configuration)) writeState(context, state);
        } catch (Exception error) {
            android.util.Log.w("OpenTubeXUploads", "Unable to update upload notification state", error);
        }
    }

    /** Drops baselines of feeds whose notifications are off. Mirrors forgetUnconfiguredFeeds. */
    static boolean forgetUnconfiguredFeeds(JSONObject state, JSONObject configuration) {
        JSONObject known = state.optJSONObject("known");
        if (known == null) return false;
        JSONObject channels = configuration.optJSONObject("channels");
        List<String> removed = new ArrayList<>();
        for (Iterator<String> keys = known.keys(); keys.hasNext();) {
            String key = keys.next();
            int separator = key.lastIndexOf(':');
            JSONObject channel = channels == null ? null : channels.optJSONObject(key.substring(0, separator));
            if (channel == null || !contains(channel.optJSONArray("feedTypes"), key.substring(separator + 1))) removed.add(key);
        }
        for (String key : removed) known.remove(key);
        return !removed.isEmpty();
    }

    /** Checks a raw response saved by the scheduled refresh worker. */
    static void observePayload(Context context, String channelId, String feedType, JSONObject payload) {
        try {
            observe(context, channelId, feedType, entries(feedType, payload, System.currentTimeMillis()));
        } catch (Exception error) {
            android.util.Log.w("OpenTubeXUploads", "Unable to check for new uploads", error);
        }
    }

    static synchronized void observe(Context context, String channelId, String feedType, JSONArray entries) throws Exception {
        String saved = preferences(context).getString(CONFIGURATION_KEY, null);
        JSONObject configuration = saved == null ? new JSONObject() : new JSONObject(saved);
        if (!configuration.optBoolean("enabled")) return;
        JSONObject channels = configuration.optJSONObject("channels");
        JSONObject channel = channels == null ? null : channels.optJSONObject(channelId);
        if (channel == null || !contains(channel.optJSONArray("feedTypes"), feedType)) return;

        List<JSONObject> available = new ArrayList<>();
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.optJSONObject(i);
            if (entry != null) available.add(entry);
        }

        // The baseline includes members-only entries, so they are not reported
        // as new once members-only content becomes visible.
        JSONObject state = readState(context);
        List<JSONObject> uploads = takeNewUploads(state, channelId, feedType, available, System.currentTimeMillis());
        writeState(context, state);
        if (!channel.optBoolean("membersOnly")) uploads.removeIf(upload -> upload.optBoolean("membersOnly"));

        JSONObject titles = configuration.optJSONObject("titles");
        String name = channel.optString("name");
        for (JSONObject upload : uploads) {
            String type = upload.optBoolean("live") ? "live" : feedType;
            String title = (titles == null ? "{channel}" : titles.optString(type, "{channel}"))
                .replace("{channel}", name.isEmpty() ? channelId : name);
            show(context, title, upload.optString("title"), url(feedType, upload.getString("id")));
        }
    }

    /**
     * Records a channel feed and returns its entries that appeared since the last
     * observation. The first observation of a feed only establishes a baseline,
     * and a response without overlap is treated as a replaced list, not as uploads.
     */
    static List<JSONObject> takeNewUploads(JSONObject state, String channelId, String feedType, List<JSONObject> entries, long now) throws Exception {
        String key = channelId + ":" + feedType;
        List<JSONObject> available = new ArrayList<>();
        for (JSONObject entry : entries) {
            if (!entry.optBoolean("upcoming") && !entry.optString("id").isEmpty()) available.add(entry);
        }
        JSONObject knownByFeed = state.optJSONObject("known");
        if (knownByFeed == null) state.put("known", knownByFeed = new JSONObject());
        JSONArray notified = state.optJSONArray("notified");
        if (notified == null) notified = new JSONArray();
        JSONArray known = knownByFeed.optJSONArray(key);

        Set<String> knownIds = new HashSet<>();
        LinkedHashSet<String> updated = new LinkedHashSet<>();
        for (JSONObject entry : available) updated.add(entry.getString("id"));
        if (known != null) for (int i = 0; i < known.length(); i++) {
            knownIds.add(known.getString(i));
            updated.add(known.getString(i));
        }
        knownByFeed.put(key, limit(updated, KNOWN_ID_LIMIT));
        List<JSONObject> uploads = new ArrayList<>();
        if (known == null) return uploads;

        int firstKnownIndex = known.length() == 0 ? available.size() : -1;
        for (int i = 0; firstKnownIndex < 0 && i < available.size(); i++) {
            if (knownIds.contains(available.get(i).getString("id"))) firstKnownIndex = i;
        }
        if (firstKnownIndex < 0) return uploads;

        // Shorts and streams can also appear in another feed of the same channel.
        Set<String> notifiedIds = new HashSet<>();
        for (int i = 0; i < notified.length(); i++) notifiedIds.add(notified.getString(i));
        LinkedHashSet<String> nextNotified = new LinkedHashSet<>();
        for (JSONObject entry : available.subList(0, firstKnownIndex)) {
            long published = entry.optLong("published");
            if (notifiedIds.contains(entry.getString("id")) ||
                !(entry.optBoolean("live") || published == 0 || now - published <= MAXIMUM_AGE_MILLIS)) continue;
            uploads.add(entry);
            nextNotified.add(entry.getString("id"));
        }
        for (int i = 0; i < notified.length(); i++) nextNotified.add(notified.getString(i));
        state.put("notified", limit(nextNotified, NOTIFIED_ID_LIMIT));
        return uploads;
    }

    /** Converts a saved refresh response into the entries produced by normalizeUploadEntries. */
    static JSONArray entries(String feedType, JSONObject payload, long now) throws Exception {
        JSONArray result = new JSONArray();
        if (feedType.equals("posts")) {
            JSONArray comments = payload.optJSONArray("comments");
            if (comments != null) {
                for (int i = 0; i < comments.length(); i++) {
                    JSONObject comment = comments.getJSONObject(i);
                    result.put(new JSONObject()
                        .put("id", comment.optString("commentId"))
                        .put("title", comment.optString("content"))
                        .put("published", comment.optLong("published") * 1000));
                }
            } else if (payload.optString("backgroundFormat").equals("local")) {
                collectPosts(payload.optJSONObject("data"), result, now);
            }
            return result;
        }
        JSONArray videos = SubscriptionRefreshDownloadMetadata.forDownloads(payload, now).optJSONArray("videos");
        if (videos == null) return result;
        for (int i = 0; i < videos.length(); i++) {
            JSONObject video = videos.getJSONObject(i);
            result.put(new JSONObject()
                .put("id", video.optString("videoId"))
                .put("title", video.optString("title"))
                .put("published", video.optLong("published") * 1000)
                .put("live", video.optBoolean("liveNow"))
                .put("upcoming", video.optBoolean("isUpcoming"))
                .put("membersOnly", video.optBoolean("isMembersOnly")));
        }
        return result;
    }

    private static void collectPosts(Object node, JSONArray posts, long now) throws Exception {
        if (node instanceof JSONArray array) {
            for (int i = 0; i < array.length(); i++) collectPosts(array.get(i), posts, now);
        } else if (node instanceof JSONObject object) {
            JSONObject post = object.optJSONObject("backstagePostRenderer");
            if (post == null) post = object.optJSONObject("postRenderer");
            if (post != null) {
                posts.put(new JSONObject()
                    .put("id", post.optString("postId"))
                    .put("title", SubscriptionRefreshDownloadMetadata.label(post.optJSONObject("contentText")))
                    .put("published", SubscriptionRefreshDownloadMetadata.published(
                        SubscriptionRefreshDownloadMetadata.label(post.optJSONObject("publishedTimeText")), now) * 1000));
                return;
            }
            for (Iterator<String> keys = object.keys(); keys.hasNext();) collectPosts(object.get(keys.next()), posts, now);
        }
    }

    static String url(String feedType, String id) {
        String encoded = Uri.encode(id);
        if (feedType.equals("posts")) return "https://www.youtube.com/post/" + encoded;
        if (feedType.equals("shorts")) return "https://www.youtube.com/shorts/" + encoded;
        return "https://www.youtube.com/watch?v=" + encoded;
    }

    private static void show(Context context, String title, String body, String url) {
        OpenTubeXNotificationChannels.createAll(context);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(context, OpenTubeXNotificationChannels.NEW_UPLOADS_ID)
            : new Notification.Builder(context);
        // MainActivity forwards YouTube links to the renderer, including on cold start.
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(url), context, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            url.hashCode(),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        builder
            .setSmallIcon(R.drawable.ic_stat_opentubex)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setContentIntent(contentIntent)
            .setAutoCancel(true);
        context.getSystemService(NotificationManager.class).notify(TAG, url.hashCode(), builder.build());
    }

    private static boolean contains(JSONArray values, String value) {
        if (values == null) return false;
        for (int i = 0; i < values.length(); i++) if (value.equals(values.optString(i))) return true;
        return false;
    }

    private static JSONArray limit(Set<String> values, int size) {
        JSONArray result = new JSONArray();
        for (String value : values) {
            if (result.length() == size) break;
            result.put(value);
        }
        return result;
    }

    private static JSONObject readState(Context context) {
        try {
            return new JSONObject(new String(Files.readAllBytes(stateFile(context).toPath()), StandardCharsets.UTF_8));
        } catch (Exception missingOrInvalid) {
            return new JSONObject();
        }
    }

    private static void writeState(Context context, JSONObject state) throws Exception {
        File file = stateFile(context);
        File temporary = new File(file.getPath() + ".tmp");
        Files.write(temporary.toPath(), state.toString().getBytes(StandardCharsets.UTF_8));
        Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    private static File stateFile(Context context) {
        return new File(context.getFilesDir(), STATE_FILE);
    }

    private static android.content.SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }
}
