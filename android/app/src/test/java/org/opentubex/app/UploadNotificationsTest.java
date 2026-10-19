package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class UploadNotificationsTest {
    private static final long NOW = 1_800_000_000_000L;
    private static final long HOUR = 3_600_000L;

    private static JSONObject entry(String id, long published) throws Exception {
        return new JSONObject().put("id", id).put("title", "Title " + id).put("published", published);
    }

    private static List<String> ids(List<JSONObject> entries) {
        List<String> result = new ArrayList<>();
        for (JSONObject entry : entries) result.add(entry.optString("id"));
        return result;
    }

    @Test
    public void notifiesEntriesAheadOfTheNewestKnownEntryOnce() throws Exception {
        JSONObject state = new JSONObject();
        assertTrue(UploadNotifications.takeNewUploads(state, "UC1", "videos",
            Arrays.asList(entry("b", NOW - HOUR), entry("a", NOW - HOUR)), NOW).isEmpty());

        List<JSONObject> feed = Arrays.asList(entry("c", NOW - HOUR), entry("b", NOW - HOUR), entry("a", NOW - HOUR));
        assertEquals(Arrays.asList("c"), ids(UploadNotifications.takeNewUploads(state, "UC1", "videos", feed, NOW)));
        assertTrue(UploadNotifications.takeNewUploads(state, "UC1", "videos", feed, NOW).isEmpty());
    }

    @Test
    public void skipsUpcomingOldAndUnrelatedEntries() throws Exception {
        JSONObject state = new JSONObject();
        UploadNotifications.takeNewUploads(state, "UC1", "live", Arrays.asList(entry("a", NOW - HOUR)), NOW);

        assertTrue(UploadNotifications.takeNewUploads(state, "UC1", "live",
            Arrays.asList(entry("x", NOW - HOUR)), NOW).isEmpty());
        assertTrue(UploadNotifications.takeNewUploads(state, "UC1", "live",
            Arrays.asList(entry("old", NOW - 8 * 24 * HOUR), entry("a", NOW - HOUR)), NOW).isEmpty());
        assertTrue(UploadNotifications.takeNewUploads(state, "UC1", "live",
            Arrays.asList(entry("stream", 0).put("upcoming", true), entry("a", NOW - HOUR)), NOW).isEmpty());
        assertEquals(Arrays.asList("stream"), ids(UploadNotifications.takeNewUploads(state, "UC1", "live",
            Arrays.asList(entry("stream", 0).put("live", true), entry("a", NOW - HOUR)), NOW)));
    }

    @Test
    public void readsVideosAndPostsFromSavedResponses() throws Exception {
        JSONObject invidiousVideos = new JSONObject().put("videos", new JSONArray()
            .put(new JSONObject().put("videoId", "jNQXAC9IVRw").put("title", "Video").put("published", 1000).put("liveNow", true)));
        JSONObject video = UploadNotifications.entries("videos", invidiousVideos, NOW).getJSONObject(0);
        assertEquals("jNQXAC9IVRw", video.getString("id"));
        assertEquals(1_000_000L, video.getLong("published"));
        assertTrue(video.getBoolean("live"));

        JSONObject invidiousPosts = new JSONObject().put("comments", new JSONArray()
            .put(new JSONObject().put("commentId", "post1").put("content", "Hello").put("published", 2000)));
        JSONObject post = UploadNotifications.entries("posts", invidiousPosts, NOW).getJSONObject(0);
        assertEquals("post1", post.getString("id"));
        assertEquals("Hello", post.getString("title"));
        assertEquals(2_000_000L, post.getLong("published"));

        JSONObject localPosts = new JSONObject().put("backgroundFormat", "local").put("data", new JSONObject()
            .put("contents", new JSONArray().put(new JSONObject().put("backstagePostThreadRenderer", new JSONObject()
                .put("post", new JSONObject().put("backstagePostRenderer", new JSONObject()
                    .put("postId", "post2")
                    .put("contentText", new JSONObject().put("runs", new JSONArray()
                        .put(new JSONObject().put("text", "Hi ")).put(new JSONObject().put("text", "there"))))
                    .put("publishedTimeText", new JSONObject().put("runs", new JSONArray()
                        .put(new JSONObject().put("text", "2 hours ago"))))))))));
        post = UploadNotifications.entries("posts", localPosts, NOW).getJSONObject(0);
        assertEquals("post2", post.getString("id"));
        assertEquals("Hi there", post.getString("title"));
        assertEquals((NOW / 1000 - 7200) * 1000, post.getLong("published"));
    }
}
