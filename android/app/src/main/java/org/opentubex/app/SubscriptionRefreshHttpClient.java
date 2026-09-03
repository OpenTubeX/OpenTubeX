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

    static JSONObject fetch(SubscriptionRefreshConfiguration.Feed feed, String channelId)
        throws IOException, JSONException {
        String subResource;
        switch (feed.type) {
            case "shorts":
                subResource = "shorts";
                break;
            case "live":
                subResource = "streams";
                break;
            case "posts":
                subResource = "community";
                break;
            default:
                subResource = "videos";
        }
        URL url = new URL(feed.instanceUrl + "/api/v1/channels/" + channelId + "/" + subResource);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(TIMEOUT_MILLIS);
        connection.setReadTimeout(TIMEOUT_MILLIS);
        connection.setRequestProperty("Accept", "application/json");
        if (feed.authorization != null) {
            connection.setRequestProperty("Authorization", feed.authorization);
        }

        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IOException("HTTP " + status);
            try (InputStream input = connection.getInputStream()) {
                JSONObject response = new JSONObject(readResponse(input));
                if (response.has("error")) {
                    String message = response.optString("error", "Invidious API error");
                    if (feed.type.equals("posts") && message.equals("This channel hasn't posted yet")) {
                        return new JSONObject().put("comments", new org.json.JSONArray());
                    }
                    throw new IOException(message);
                }
                return response;
            }
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
