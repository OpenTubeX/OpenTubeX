package org.opentubex.app;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Announces broadcasts of followed Twitch channels, for the checks of the visible
 * app and of TwitchLiveWorker, which checks while the app is hidden or closed.
 * Mirrors takeNewTwitchStreams in src/twitchFollows.js.
 */
final class TwitchLiveNotifications {
    private static final String PREFERENCES = "twitch-live";
    private static final String CONFIGURATION_KEY = "configuration";
    private static final String STATE_FILE = "twitch-live-notifications.json";
    static final String WORK_NAME = "twitch-live-checks";
    // WorkManager's shortest period
    private static final long CHECK_INTERVAL_MINUTES = 15;
    private static final int KNOWN_STREAMS_PER_CHANNEL = 20;
    // Channels per request, like the app's requests
    private static final int BATCH_SIZE = 20;
    private static final int TIMEOUT_MILLIS = 15_000;
    private static final int MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;
    private static final String GQL_URL = "https://gql.twitch.tv/gql";
    // Twitch's public web client, which the app also uses for chat and avatars
    private static final String CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
    private static final String QUERY =
        "query($ids: [ID!]) { users(ids: $ids) { id stream { id title previewImageURL(width: 640, height: 360) } } }";
    private static final Pattern ID = Pattern.compile("\\d{1,20}");
    private static final Pattern LOGIN = Pattern.compile("[a-z0-9_]{1,25}");
    private static final Pattern STREAM_ID = Pattern.compile("[\\w-]{1,40}");

    private TwitchLiveNotifications() {}

    /**
     * Saves which channels to check, and checks while the app is closed only when
     * the app may refresh subscriptions then.
     */
    static synchronized void configure(Context context, JSONObject configuration) {
        preferences(context).edit().putString(CONFIGURATION_KEY, configuration.toString()).commit();
        // Turning notifications on again starts from the streams that are live then.
        if (!isEnabled(configuration)) stateFile(context).delete();
        WorkManager work = WorkManager.getInstance(context);
        if (isEnabled(configuration) && configuration.optBoolean("closedApp")) {
            work.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP,
                new PeriodicWorkRequest.Builder(TwitchLiveWorker.class, CHECK_INTERVAL_MINUTES, TimeUnit.MINUTES)
                    .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .build());
        } else {
            work.cancelUniqueWork(WORK_NAME);
        }
    }

    /** Checks the configured channels, for the worker. */
    static void check(Context context) throws Exception {
        JSONObject configuration = configuration(context);
        if (!isEnabled(configuration)) return;
        List<String> channelIds = channelIds(configuration);
        observe(context, channelIds, fetchLiveStreams(channelIds));
    }

    /**
     * Records the live streams of the checked channels and announces the ones
     * that started since the last check. Holds the monitor shared with configure,
     * so notifications turned off during a check stay off.
     * @param checked the channels the streams were requested for
     */
    static synchronized void observe(Context context, List<String> checked, JSONArray streams) throws Exception {
        JSONObject configuration = configuration(context);
        if (!isEnabled(configuration)) return;
        File file = stateFile(context);
        JSONObject state = readState(file);
        JSONObject known = state.optJSONObject("known");
        if (known == null) known = new JSONObject();
        List<JSONObject> fresh = takeNewStreams(known, channelIds(configuration), checked, streams);
        state.put("known", known);
        writeState(file, state);
        for (JSONObject stream : fresh) announce(context, configuration, stream);
    }

    /**
     * Returns the streams that weren't live at the last check of their channel. The
     * first check of a channel only records its stream, so following a channel that
     * is live announces nothing. Channels followed during the check weren't checked,
     * so their first check is still to come.
     */
    static List<JSONObject> takeNewStreams(JSONObject known, List<String> channelIds, List<String> checked, JSONArray streams) throws JSONException {
        Set<String> followed = new LinkedHashSet<>(channelIds);
        List<String> unfollowed = new ArrayList<>();
        for (Iterator<String> keys = known.keys(); keys.hasNext();) {
            String channelId = keys.next();
            if (!followed.contains(channelId)) unfollowed.add(channelId);
        }
        for (String channelId : unfollowed) known.remove(channelId);

        List<JSONObject> fresh = new ArrayList<>();
        for (String channelId : followed) {
            if (!checked.contains(channelId)) continue;
            JSONArray previous = known.optJSONArray(channelId);
            Set<String> previousIds = new LinkedHashSet<>();
            if (previous != null) {
                for (int index = 0; index < previous.length(); index++) previousIds.add(previous.optString(index));
            }
            Set<String> ids = new LinkedHashSet<>();
            for (int index = 0; index < streams.length(); index++) {
                JSONObject stream = streams.optJSONObject(index);
                String id = stream == null ? "" : stream.optString("id");
                if (id.isEmpty() || !channelId.equals(stream.optString("channelId"))) continue;
                if (previous != null && !previousIds.contains(id)) fresh.add(stream);
                ids.add(id);
            }
            // Streams that drop out of a response for a moment aren't announced again.
            ids.addAll(previousIds);
            JSONArray kept = new JSONArray();
            for (String id : ids) {
                if (kept.length() == KNOWN_STREAMS_PER_CHANNEL) break;
                kept.put(id);
            }
            known.put(channelId, kept);
        }
        return fresh;
    }

    /** Reads the streams of a response, with the fields the app sends too. */
    static JSONArray parseLiveStreams(JSONObject response) throws IOException, JSONException {
        JSONObject data = response.optJSONObject("data");
        JSONArray users = data == null ? null : data.optJSONArray("users");
        // Fields can fail on their own, but without users nothing was checked.
        if (users == null) throw new IOException("Twitch returned no channels");
        JSONArray streams = new JSONArray();
        for (int index = 0; index < users.length(); index++) {
            JSONObject user = users.optJSONObject(index);
            JSONObject stream = user == null ? null : user.optJSONObject("stream");
            if (stream == null || !ID.matcher(user.optString("id")).matches() ||
                !STREAM_ID.matcher(stream.optString("id")).matches()) continue;
            String thumbnail = stream.optString("previewImageURL");
            streams.put(new JSONObject()
                .put("channelId", user.getString("id"))
                .put("id", stream.getString("id"))
                .put("title", stream.optString("title"))
                .putOpt("thumbnail", thumbnail.startsWith("https://") ? thumbnail : null));
        }
        return streams;
    }

    private static JSONArray fetchLiveStreams(List<String> channelIds) throws Exception {
        JSONArray streams = new JSONArray();
        for (int start = 0; start < channelIds.size(); start += BATCH_SIZE) {
            List<String> batch = channelIds.subList(start, Math.min(channelIds.size(), start + BATCH_SIZE));
            JSONObject body = new JSONObject()
                .put("query", QUERY)
                .put("variables", new JSONObject().put("ids", new JSONArray(batch)));
            JSONArray batchStreams = parseLiveStreams(new JSONObject(post(body.toString())));
            for (int index = 0; index < batchStreams.length(); index++) streams.put(batchStreams.get(index));
        }
        return streams;
    }

    private static String post(String body) throws IOException {
        // Goes through the app's proxy, like the app's own requests.
        HttpURLConnection connection = (HttpURLConnection) AndroidProxy.openConnection(new URL(GQL_URL));
        try {
            connection.setConnectTimeout(TIMEOUT_MILLIS);
            connection.setReadTimeout(TIMEOUT_MILLIS);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Client-ID", CLIENT_ID);
            connection.setRequestProperty("Content-Type", "application/json");
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.getBytes(StandardCharsets.UTF_8));
            }
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IOException("Twitch returned HTTP " + connection.getResponseCode());
            }
            ByteArrayOutputStream response = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[8192];
                for (int count; (count = input.read(buffer)) >= 0;) {
                    response.write(buffer, 0, count);
                    if (response.size() > MAXIMUM_RESPONSE_BYTES) throw new IOException("Twitch response is too large");
                }
            }
            return response.toString(StandardCharsets.UTF_8.name());
        } finally {
            connection.disconnect();
        }
    }

    private static void announce(Context context, JSONObject configuration, JSONObject stream) {
        JSONObject channel = findChannel(configuration, stream.optString("channelId"));
        if (channel == null) return;
        String login = channel.optString("login");
        String streamId = stream.optString("id");
        String name = channel.optString("name", login);
        String title = configuration.optString("title", "{channel}").replace("{channel}", name.isEmpty() ? login : name);
        String thumbnail = configuration.optBoolean("thumbnails") ? stream.optString("thumbnail", null) : null;
        // With both, the app keeps a history and shows notifications itself while visible.
        boolean history = "both".equals(configuration.optString("mode", "both"));
        UploadNotifications.deliver(context, "twitch", login + "/" + streamId, true, title,
            stream.optString("title"), thumbnail, history, false);
    }

    private static boolean isEnabled(JSONObject configuration) {
        return configuration.optBoolean("enabled") && !channelIds(configuration).isEmpty();
    }

    private static List<String> channelIds(JSONObject configuration) {
        List<String> ids = new ArrayList<>();
        JSONArray channels = configuration.optJSONArray("channels");
        if (channels == null) return ids;
        for (int index = 0; index < channels.length(); index++) {
            JSONObject channel = channels.optJSONObject(index);
            if (channel != null && ID.matcher(channel.optString("id")).matches() &&
                LOGIN.matcher(channel.optString("login")).matches()) ids.add(channel.optString("id"));
        }
        return ids;
    }

    private static JSONObject findChannel(JSONObject configuration, String channelId) {
        JSONArray channels = configuration.optJSONArray("channels");
        if (channels == null) return null;
        for (int index = 0; index < channels.length(); index++) {
            JSONObject channel = channels.optJSONObject(index);
            if (channel != null && channelId.equals(channel.optString("id")) &&
                LOGIN.matcher(channel.optString("login")).matches()) return channel;
        }
        return null;
    }

    private static JSONObject configuration(Context context) throws JSONException {
        String saved = preferences(context).getString(CONFIGURATION_KEY, null);
        return saved == null ? new JSONObject() : new JSONObject(saved);
    }

    private static JSONObject readState(File file) throws IOException {
        if (!file.exists()) return new JSONObject();
        try {
            return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        } catch (JSONException invalid) {
            return new JSONObject();
        }
    }

    private static void writeState(File file, JSONObject state) throws IOException {
        File temporary = new File(file.getPath() + ".tmp");
        Files.write(temporary.toPath(), state.toString().getBytes(StandardCharsets.UTF_8));
        Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    private static File stateFile(Context context) {
        return new File(context.getFilesDir(), STATE_FILE);
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }
}
