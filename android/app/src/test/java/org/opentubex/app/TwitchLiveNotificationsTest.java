package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class TwitchLiveNotificationsTest {
    private static JSONObject stream(String channelId, String id) throws Exception {
        return new JSONObject().put("channelId", channelId).put("id", id).put("title", "Stream " + id);
    }

    private static List<String> ids(List<JSONObject> streams) {
        List<String> ids = new ArrayList<>();
        for (JSONObject stream : streams) ids.add(stream.optString("id"));
        return ids;
    }

    @Test
    public void announcesEachBroadcastOnceAfterTheFirstCheckOfItsChannel() throws Exception {
        JSONObject known = new JSONObject();
        List<String> channels = Arrays.asList("1", "2");
        // Live at the first check, so not news
        assertTrue(TwitchLiveNotifications.takeNewStreams(known, channels, channels, new JSONArray().put(stream("1", "a"))).isEmpty());
        // Offline for a moment, then live with the same stream
        assertTrue(TwitchLiveNotifications.takeNewStreams(known, channels, channels, new JSONArray()).isEmpty());
        assertTrue(TwitchLiveNotifications.takeNewStreams(known, channels, channels, new JSONArray().put(stream("1", "a"))).isEmpty());
        assertEquals(Arrays.asList("b", "c"), ids(TwitchLiveNotifications.takeNewStreams(known, channels, channels,
            new JSONArray().put(stream("1", "b")).put(stream("2", "c")))));

        // A channel followed later starts from its current stream, and unfollowed ones are forgotten
        List<String> later = Arrays.asList("2", "3");
        assertTrue(TwitchLiveNotifications.takeNewStreams(known, later, later,
            new JSONArray().put(stream("2", "c")).put(stream("3", "d")).put(stream("9", "x"))).isEmpty());
        assertFalse(known.has("1"));
        assertFalse(known.has("9"));
        assertEquals("[\"d\"]", known.getJSONArray("3").toString());

        // A channel followed during a check wasn't checked, so its first check is still to come
        List<String> followedDuringCheck = Arrays.asList("2", "3", "4");
        assertTrue(TwitchLiveNotifications.takeNewStreams(known, followedDuringCheck, later, new JSONArray()).isEmpty());
        assertFalse(known.has("4"));
        assertTrue(TwitchLiveNotifications.takeNewStreams(known, followedDuringCheck, followedDuringCheck,
            new JSONArray().put(stream("4", "e"))).isEmpty());
    }

    @Test
    public void readsLiveStreamsAndRejectsResponsesWithoutChannels() throws Exception {
        JSONObject response = new JSONObject().put("data", new JSONObject().put("users", new JSONArray()
            .put(new JSONObject().put("id", "1").put("stream", new JSONObject()
                .put("id", "100").put("title", "Live").put("previewImageURL", "https://cdn.example.test/live.jpg")))
            .put(new JSONObject().put("id", "2").put("stream", JSONObject.NULL))
            .put(JSONObject.NULL)
            .put(new JSONObject().put("id", "3").put("stream", new JSONObject().put("id", "1&x").put("previewImageURL", "https://cdn.example.test/live.jpg")))
            .put(new JSONObject().put("id", "4").put("stream", new JSONObject().put("id", "400").put("previewImageURL", "http://cdn.example.test/live.jpg")))));
        JSONArray streams = TwitchLiveNotifications.parseLiveStreams(response);
        assertEquals(2, streams.length());
        JSONObject stream = streams.getJSONObject(0);
        assertEquals("1", stream.getString("channelId"));
        assertEquals("100", stream.getString("id"));
        assertEquals("https://cdn.example.test/live.jpg", stream.getString("thumbnail"));
        // A stream with an insecure thumbnail is kept, without it
        JSONObject insecure = streams.getJSONObject(1);
        assertEquals("400", insecure.getString("id"));
        assertFalse(insecure.has("thumbnail"));

        assertThrows(IOException.class, () -> TwitchLiveNotifications.parseLiveStreams(new JSONObject().put("errors", new JSONArray())));
    }
}
