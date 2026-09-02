package org.opentubex.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class SubscriptionRefreshConfiguration {
    static final String[] FEED_TYPES = { "videos", "shorts", "live", "posts" };
    private static final String PREFERENCES = "subscription-refresh";
    private static final String CONFIGURATION_KEY = "configuration";

    static final class Feed {
        final String profileId;
        final String type;
        final long intervalMillis;
        final List<String> channelIds;
        final String instanceUrl;
        final String authorization;
        final String title;
        final String cancelLabel;

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

    static void save(Context context, JSONObject configuration) {
        preferences(context).edit().putString(CONFIGURATION_KEY, configuration.toString()).commit();
    }

    static List<Feed> readFeeds(Context context) {
        String encoded = preferences(context).getString(CONFIGURATION_KEY, null);
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

    private static List<Feed> parseFeeds(JSONObject configuration) throws JSONException {
        String instanceUrl = configuration.optString("instanceUrl", "").replaceAll("/+$", "");
        if (!instanceUrl.startsWith("https://")) return Collections.emptyList();

        String authorization = configuration.optString("authorization", null);
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

                feeds.add(new Feed(
                    profileId,
                    type,
                    intervalMillis,
                    channelIds,
                    instanceUrl,
                    authorization,
                    titles == null ? "Refreshing subscriptions" : titles.optString(type, "Refreshing subscriptions"),
                    cancelLabel
                ));
            }
        }
        return feeds;
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }
}
