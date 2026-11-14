package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class CommentReplyNotificationsTest {
    private static JSONObject entity(String id, String channelId, String name, String text, String replyCount) throws Exception {
        return new JSONObject().put("payload", new JSONObject().put("commentEntityPayload", new JSONObject()
            .put("properties", new JSONObject().put("commentId", id).put("content", new JSONObject().put("content", text)))
            .put("author", new JSONObject().put("channelId", channelId).put("displayName", name))
            .put("toolbar", new JSONObject().put("replyCount", replyCount))));
    }

    private static JSONObject viewModel(String id) throws Exception {
        return new JSONObject().put("commentViewModel", new JSONObject().put("commentViewModel", new JSONObject().put("commentId", id)));
    }

    private static JSONObject replyViewModel(String id) throws Exception {
        return new JSONObject().put("commentViewModel", new JSONObject().put("commentId", id));
    }

    private static JSONObject continuation(String token) throws Exception {
        return new JSONObject().put("continuationItemRenderer", new JSONObject().put("continuationEndpoint",
            new JSONObject().put("continuationCommand", new JSONObject().put("token", token))));
    }

    @Test
    public void readsTheLinkedThreadAndItsReplyPages() throws Exception {
        JSONObject thread = new JSONObject().put("commentThreadRenderer", viewModel("thread1")
            .put("replies", new JSONObject().put("commentRepliesRenderer",
                new JSONObject().put("contents", new JSONArray().put(continuation("Eg+replies/x=="))))));
        JSONObject linked = new JSONObject()
            .put("onResponseReceivedEndpoints", new JSONArray().put(new JSONObject().put("reloadContinuationItemsCommand",
                new JSONObject().put("continuationItems", new JSONArray().put(thread)))))
            .put("frameworkUpdates", new JSONObject().put("entityBatchUpdate", new JSONObject().put("mutations",
                new JSONArray().put(entity("thread1", "UCme", "@Me", "Comment", "7")))));
        JSONObject parsed = CommentReplyNotifications.parseThread(linked, "thread1");
        assertEquals(7, parsed.getInt("replyCount"));
        assertEquals("Eg+replies/x==", parsed.getString("repliesToken"));
        assertNull(CommentReplyNotifications.parseThread(linked, "missing"));

        // Entities come in another order than the replies they show.
        JSONObject page = new JSONObject()
            .put("onResponseReceivedEndpoints", new JSONArray().put(new JSONObject().put("appendContinuationItemsAction",
                new JSONObject().put("continuationItems", new JSONArray()
                    .put(replyViewModel("thread1.a"))
                    .put(replyViewModel("thread1.b"))
                    .put(new JSONObject().put("continuationItemRenderer", new JSONObject().put("button", new JSONObject()
                        .put("buttonRenderer", new JSONObject().put("command", new JSONObject()
                            .put("continuationCommand", new JSONObject().put("token", "next%3D")))))))))))
            .put("frameworkUpdates", new JSONObject().put("entityBatchUpdate", new JSONObject().put("mutations", new JSONArray()
                .put(entity("thread1.b", "UCtwo", "@Two", "\u200B \u2068@Me\u2069  thanks ", "0"))
                .put(entity("thread1.a", "UCone", "@One", "First", "0")))));
        JSONObject replies = CommentReplyNotifications.parseReplies(page);
        JSONArray list = replies.getJSONArray("replies");
        assertEquals("thread1.a", list.getJSONObject(0).getString("id"));
        assertEquals("@Me thanks", list.getJSONObject(1).getString("text"));
        assertEquals("UCtwo", list.getJSONObject(1).getString("authorId"));
        assertEquals("next%3D", replies.getString("nextToken"));
    }

    private static JSONObject reply(String id, String authorId, String text) throws Exception {
        return new JSONObject().put("id", "thread1." + id).put("authorId", authorId).put("author", authorId).put("text", text);
    }

    private static JSONArray ids(JSONArray replies) throws Exception {
        JSONArray ids = new JSONArray();
        for (int index = 0; index < replies.length(); index++) ids.put(replies.getJSONObject(index).getString("id"));
        return ids;
    }

    @Test
    public void announcesRepliesLikeTheOtherPlatforms() throws Exception {
        JSONObject comment = new JSONObject().put("videoId", "video1").put("threadId", "thread1").put("commentId", "thread1")
            .put("channelId", "UCme").put("handle", "@Me").put("token", "token%3D");
        JSONObject own = CommentReplyNotifications.trackPostedComment(new JSONArray(), comment, 1000).getJSONObject(0);
        JSONObject first = CommentReplyNotifications.findNewReplies(own, new JSONArray()
            .put(reply("a", "UCother", "Nice")).put(reply("b", "UCme", "Mine")));
        assertEquals("[\"thread1.a\"]", ids(first.getJSONArray("added")).toString());
        own.put("seen", first.getJSONArray("seen"));
        assertEquals("[]", ids(CommentReplyNotifications.findNewReplies(own, new JSONArray().put(reply("a", "UCother", "Nice")))
            .getJSONArray("added")).toString());

        JSONObject replyComment = new JSONObject(comment.toString()).put("commentId", "thread1.mine");
        JSONObject other = CommentReplyNotifications.trackPostedComment(new JSONArray(), replyComment, 1000).getJSONObject(0);
        JSONArray replies = new JSONArray()
            .put(reply("before", "UCother", "@Me earlier"))
            .put(reply("mine", "UCme", "My reply"))
            .put(reply("longer", "UCother", "@Meé hello"))
            .put(reply("mention", "UCother", "Thanks @me."));
        assertEquals("[\"thread1.mention\"]", ids(CommentReplyNotifications.findNewReplies(other, replies).getJSONArray("added")).toString());
        // Without the account's reply, earlier mentions do not count as answers.
        assertEquals("[]", ids(CommentReplyNotifications.findNewReplies(other, new JSONArray()
            .put(reply("mention", "UCother", "@Me hi"))).getJSONArray("added")).toString());
    }

    @Test
    public void watchesRecentThreadsOnceEach() throws Exception {
        JSONObject comment = new JSONObject().put("videoId", "video1").put("threadId", "thread1").put("commentId", "thread1")
            .put("channelId", "UCme").put("handle", JSONObject.NULL).put("token", "token%3D");
        JSONArray threads = CommentReplyNotifications.trackPostedComment(new JSONArray(), comment, 1000);
        threads.getJSONObject(0).put("seen", new JSONArray().put("thread1.a"));
        threads = CommentReplyNotifications.trackPostedComment(threads,
            new JSONObject(comment.toString()).put("commentId", "thread1.later"), 5000);
        assertEquals(1, threads.length());
        assertEquals("thread1", threads.getJSONObject(0).getString("commentId"));
        assertEquals(5000, threads.getJSONObject(0).getLong("postedAt"));
        assertEquals("[\"thread1.a\"]", threads.getJSONObject(0).getJSONArray("seen").toString());
        assertEquals(0, CommentReplyNotifications.normalize(threads, 5000 + CommentReplyNotifications.TRACKING_MILLIS).size());
    }
}
