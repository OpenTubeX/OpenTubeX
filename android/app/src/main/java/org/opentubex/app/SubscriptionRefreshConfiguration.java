package org.opentubex.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class SubscriptionRefreshConfiguration {
    static final String[] FEED_TYPES = { "videos", "shorts", "live", "posts" };
    private static final String TAG = "SubscriptionRefresh";
    private static final String PREFERENCES = "subscription-refresh";
    // Earlier versions saved it unencrypted, and so does this one when the Keystore fails.
    private static final String CONFIGURATION_KEY = "configuration";
    // It holds the API server's Authorization header.
    private static final String ENCRYPTED_CONFIGURATION_KEY = "encryptedConfiguration";

    static final class Feed {
        final String profileId;
        final String type;
        final long intervalMillis;
        final List<String> channelIds;
        final String instanceUrl;
        final String authorization;
        final String title;
        final String cancelLabel;
        JSONArray requests;

        Feed(
            String profileId,
            String type,
            long intervalMillis,
            List<String> channelIds,
            String instanceUrl,
            String authorization,
            String title,
            String cancelLabel
        ) {
            this.profileId = profileId;
            this.type = type;
            this.intervalMillis = intervalMillis;
            this.channelIds = Collections.unmodifiableList(channelIds);
            this.instanceUrl = instanceUrl;
            this.authorization = authorization;
            this.title = title;
            this.cancelLabel = cancelLabel;
        }
    }

    private SubscriptionRefreshConfiguration() {}

    static synchronized void save(Context context, JSONObject configuration) {
        write(preferences(context), configuration.toString());
    }

    /** Saves the configuration encrypted, or as it is when the Keystore fails. */
    private static void write(SharedPreferences preferences, String configuration) {
        SharedPreferences.Editor editor = preferences.edit();
        try {
            editor.putString(ENCRYPTED_CONFIGURATION_KEY, SecretStorage.encrypt(configuration)).remove(CONFIGURATION_KEY);
        } catch (Exception error) {
            Log.e(TAG, "Unable to encrypt the background refresh settings, saving them unencrypted", error);
            editor.putString(CONFIGURATION_KEY, configuration).remove(ENCRYPTED_CONFIGURATION_KEY);
        }
        editor.commit();
    }

    /**
     * The saved configuration. One this installation cannot decrypt, such as
     * one restored from another device, is deleted until the app configures
     * the refreshes again. One saved unencrypted is encrypted.
     */
    static synchronized String read(Context context) {
        SharedPreferences preferences = preferences(context);
        String encrypted = preferences.getString(ENCRYPTED_CONFIGURATION_KEY, null);
        if (encrypted == null) {
            String configuration = preferences.getString(CONFIGURATION_KEY, null);
            if (configuration != null) write(preferences, configuration);
            return configuration;
        }
        try {
            String configuration = SecretStorage.decrypt(encrypted);
            if (configuration == null) {
                Log.w(TAG, "Deleting the background refresh settings, which cannot be decrypted on this device");
                preferences.edit().remove(ENCRYPTED_CONFIGURATION_KEY).commit();
            }
            return configuration;
        } catch (Exception error) {
            // The next refresh tries again.
            Log.e(TAG, "Unable to decrypt the background refresh settings", error);
            return null;
        }
    }

    static List<Feed> readFeeds(Context context) {
        String encoded = read(context);
        if (encoded == null) return Collections.emptyList();

        try {
            return parseFeeds(new JSONObject(encoded));
        } catch (JSONException error) {
            return Collections.emptyList();
        }
    }

    static List<Feed> findFeeds(Context context, String type) {
        List<Feed> matches = new ArrayList<>();
        for (Feed feed : readFeeds(context)) {
            if (feed.type.equals(type)) matches.add(feed);
        }
        return matches;
    }

    static List<Feed> parseFeeds(JSONObject configuration) throws JSONException {
        String instanceUrl = configuration.optString("instanceUrl", "").replaceAll("/+$", "");


        String authorization = configuration.isNull("authorization")
            ? null
            : configuration.optString("authorization", null);
        if (authorization != null && authorization.isEmpty()) authorization = null;
        String cancelLabel = configuration.optString("cancelLabel", "Cancel");
        JSONObject intervals = configuration.optJSONObject("intervals");
        JSONObject titles = configuration.optJSONObject("titles");
        JSONArray profiles = configuration.optJSONArray("profiles");
        if (intervals == null || profiles == null) return Collections.emptyList();

        List<Feed> feeds = new ArrayList<>();
        for (int profileIndex = 0; profileIndex < profiles.length(); profileIndex++) {
            JSONObject profile = profiles.optJSONObject(profileIndex);
            if (profile == null) continue;
            String profileId = profile.optString("id", "");
            JSONObject channels = profile.optJSONObject("channels");
            if (profileId.isEmpty() || channels == null) continue;

            for (String type : FEED_TYPES) {
                long intervalMillis = intervals.optLong(type, 0);
                if (intervalMillis <= 0) continue;

                JSONArray ids = channels.optJSONArray(type);
                List<String> channelIds = new ArrayList<>();
                if (ids != null) {
                    for (int channelIndex = 0; channelIndex < ids.length(); channelIndex++) {
                        String channelId = ids.optString(channelIndex, "");
                        if (channelId.matches("[A-Za-z0-9_-]+")) channelIds.add(channelId);
                    }
                }

                Feed feed = new Feed(
                    profileId,
                    type,
                    intervalMillis,
                    channelIds,
                    instanceUrl,
                    authorization,
                    titles == null ? "Refreshing subscriptions" : titles.optString(type, "Refreshing subscriptions"),
                    cancelLabel
                );
                JSONObject requests = configuration.optJSONObject("requests");
                feed.requests = requests == null ? null : requests.optJSONArray(type);
                if (feed.requests != null || instanceUrl.startsWith("https://")) feeds.add(feed);
            }
        }
        return feeds;
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }
}
