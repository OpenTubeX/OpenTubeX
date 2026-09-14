package org.opentubex.app;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class SubscriptionRefreshHttpClient {
    private static final int TIMEOUT_MILLIS = 20_000;
    private static final int MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024;

    private SubscriptionRefreshHttpClient() {}

    @FunctionalInterface
    interface RequestFetcher {
        String fetch(JSONObject request, String type, String channelId) throws IOException, JSONException;
    }

    static JSONObject fetch(SubscriptionRefreshConfiguration.Feed feed, String channelId)
        throws IOException, JSONException {
        return fetch(feed, channelId, SubscriptionRefreshHttpClient::fetchRequest);
    }

    static JSONObject fetch(SubscriptionRefreshConfiguration.Feed feed, String channelId, RequestFetcher fetcher)
        throws IOException, JSONException {
        // Older installed configurations used Invidious only. They are replaced
        // by the settings snapshot when the updated app first opens.
        if (feed.requests == null) throw new IOException("Open the app to update background refresh settings");
        Exception lastError = null;
        for (int index = 0; index < feed.requests.length(); index++) {
            if (Thread.currentThread().isInterrupted()) throw new IOException("Refresh cancelled");
            JSONObject request = feed.requests.getJSONObject(index);
            try {
                String format = request.getString("format");
                String responseText = fetcher.fetch(request, feed.type, channelId);
                if (format.equals("rss")) {
                    if (!responseText.matches("(?s).*<feed[\\s>].*") || !responseText.contains("</feed>")) {
                        throw new IOException("Invalid subscription RSS response");
                    }
                    return new JSONObject().put("backgroundFormat", "rss").put("text", responseText);
                }
                JSONObject response = new JSONObject(responseText);
                if (response.has("error")) {
                    if (feed.type.equals("posts") && response.optString("error").equals("This channel hasn't posted yet")) {
                        return new JSONObject().put("comments", new org.json.JSONArray());
                    }
                    throw new IOException("Subscription API returned an error");
                }
                if (format.equals("local") || format.equals("localPlaylist")) {
                    if (!response.has("contents") || response.optString("alerts").contains("\"type\":\"ERROR\"")) {
                        throw new IOException("Channel unavailable");
                    }
                    JSONObject metadata = response.optJSONObject("metadata");
                    JSONObject channelMetadata = metadata == null ? null : metadata.optJSONObject("channelMetadataRenderer");
                    if (format.equals("local") && feed.type.equals("videos") && channelMetadata != null &&
                        !channelMetadata.optString("musicArtistName").isEmpty() && !hasSelectedVideosTab(response.opt("contents"))) {
                        throw new IOException("Topic channel requires its uploads playlist");
                    }
                    JSONObject payload = new JSONObject().put("backgroundFormat", format).put("data", response);
                    if (format.equals("local") && feed.type.equals("live")) {
                        JSONObject page = response;
                        for (int count = 0; ; count++) {
                            String token = emptyLiveContinuation(page);
                            if (token == null) break;
                            if (count >= 20 || Thread.currentThread().isInterrupted()) throw new IOException("Live feed continuation stopped");
                            JSONObject next = new JSONObject(request.toString());
                            JSONObject body = new JSONObject(request.getString("body"));
                            body.remove("browseId");
                            body.remove("params");
                            body.put("continuation", token);
                            next.put("body", body.toString());
                            page = new JSONObject(fetcher.fetch(next, feed.type, channelId));
                            if (page.has("error")) throw new IOException("Live feed continuation failed");
                            payload.put("continuation", page);
                        }
                    }
                    return payload;
                }
                if (response.optJSONArray(feed.type.equals("posts") ? "comments" : "videos") == null) {
                    throw new IOException("Invalid subscription API response");
                }
                return response;
            } catch (IOException | JSONException error) {
                lastError = error;
            }
        }
        throw new IOException("Background subscription requests failed", lastError);
    }

    private static Object find(Object node, String key) {
        if (node instanceof JSONObject) {
            JSONObject object = (JSONObject) node;
            if (object.has(key)) return object.opt(key);
            for (java.util.Iterator<String> keys = object.keys(); keys.hasNext();) {
                Object found = find(object.opt(keys.next()), key);
                if (found != null) return found;
            }
        } else if (node instanceof org.json.JSONArray) {
            org.json.JSONArray array = (org.json.JSONArray) node;
            for (int i = 0; i < array.length(); i++) {
                Object found = find(array.opt(i), key);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static boolean hasSelectedVideosTab(Object node) {
        if (node instanceof JSONObject) {
            JSONObject object = (JSONObject) node;
            JSONObject tab = object.optJSONObject("tabRenderer");
            if (tab != null && tab.optBoolean("selected")) {
                Object url = find(tab.opt("endpoint"), "url");
                return url instanceof String && ((String) url).endsWith("/videos");
            }
            for (java.util.Iterator<String> keys = object.keys(); keys.hasNext();) {
                if (hasSelectedVideosTab(object.opt(keys.next()))) return true;
            }
        } else if (node instanceof org.json.JSONArray) {
            org.json.JSONArray array = (org.json.JSONArray) node;
            for (int i = 0; i < array.length(); i++) if (hasSelectedVideosTab(array.opt(i))) return true;
        }
        return false;
    }

    static String emptyLiveContinuation(JSONObject response) {
        Object contents = response.opt("contents");
        if (contents == null) contents = response.opt("onResponseReceivedActions");
        if (contents == null) contents = response.opt("onResponseReceivedEndpoints");
        if (find(contents, "videoRenderer") != null || find(contents, "gridVideoRenderer") != null || find(contents, "lockupViewModel") != null) return null;
        Object command = find(contents, "continuationCommand");
        return command instanceof JSONObject ? ((JSONObject) command).optString("token", null) : null;
    }

    private static String substitute(String template, String type, String channelId) throws IOException {
        if (!channelId.matches("[A-Za-z0-9_-]+")) throw new IOException("Invalid channel ID");
        String prefix = type.equals("shorts") ? "UUSH" : type.equals("live") ? "UULV" : "UULF";
        return template.replace("%CHANNEL%", channelId).replace("%PLAYLIST%", channelId.replaceFirst("^UC", prefix));
    }

    private static String fetchRequest(JSONObject request, String type, String channelId)
        throws IOException, JSONException {
        URL url = new URL(substitute(request.getString("url"), type, channelId));
        if (!url.getProtocol().equals("https")) throw new IOException("Background refresh requires HTTPS");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(TIMEOUT_MILLIS);
        connection.setReadTimeout(TIMEOUT_MILLIS);
        // Never forward credentials to a redirect target.
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json, application/atom+xml");
        String authorization = request.optString("authorization", "");
        if (!authorization.isEmpty() && !authorization.equals("null")) connection.setRequestProperty("Authorization", authorization);
        try {
            if (request.has("body")) {
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                byte[] body = substitute(request.getString("body"), type, channelId).getBytes(StandardCharsets.UTF_8);
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body); }
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IOException("HTTP " + status);
            try (InputStream input = connection.getInputStream()) { return readResponse(input); }
        } finally {
            connection.disconnect();
        }
    }

    private static String readResponse(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) >= 0) {
            if (output.size() + count > MAXIMUM_RESPONSE_BYTES) {
                throw new IOException("Subscription response is too large");
            }
            output.write(buffer, 0, count);
        }
        return output.toString(StandardCharsets.UTF_8.name());
    }
}
