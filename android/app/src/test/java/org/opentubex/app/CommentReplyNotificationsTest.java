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
                    .put(new JSONObject().put("commentThreadRenderer", viewModel("thread1.b")))
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
    public void readsWhetherTheLinkedCommentOrReplyIsHearted() throws Exception {
        JSONObject reply = entity("thread1.a", "UCme", "@Me", "Reply", "");
        JSONObject replyEntity = reply.getJSONObject("payload").getJSONObject("commentEntityPayload");
        replyEntity.getJSONObject("properties").put("toolbarStateKey", "state1");
        replyEntity.getJSONObject("toolbar").put("heartActiveTooltip", "❤ by @Creator.Name");
        JSONObject response = new JSONObject().put("frameworkUpdates", new JSONObject().put("entityBatchUpdate",
            new JSONObject().put("mutations", new JSONArray()
                .put(entity("thread1", "UCother", "@Other", "Comment", "1"))
                .put(reply)
                .put(new JSONObject().put("payload", new JSONObject().put("engagementToolbarStateEntityPayload",
                    new JSONObject().put("key", "state1").put("heartState", "TOOLBAR_HEART_STATE_HEARTED")))))));

        JSONObject heart = CommentReplyNotifications.parseHeart(response, "thread1.a");
        assertEquals(true, heart.getBoolean("hearted"));
        assertEquals("@Creator.Name", heart.getString("author"));
        // Without its toolbar state, as in a response that does not link it
        assertNull(CommentReplyNotifications.parseHeart(response, "thread1"));
        assertNull(CommentReplyNotifications.parseHeart(response, "thread1.b"));
    }

    @Test
    public void announcesRepliesLikeTheOtherPlatforms() throws Exception {
        JSONObject comment = new JSONObject().put("videoId", "video1").put("threadId", "thread1").put("commentId", "thread1")
            .put("channelId", "UCme").put("handle", "@Me").put("token", "token%3D");
        JSONObject own = CommentReplyNotifications.trackComment(new JSONArray(), comment, 1000).getJSONObject(0);
        JSONObject first = CommentReplyNotifications.findNewReplies(own, new JSONArray()
            .put(reply("a", "UCother", "Nice")).put(reply("b", "UCme", "Mine")));
        assertEquals("[\"thread1.a\"]", ids(first.getJSONArray("added")).toString());
        own.put("seen", first.getJSONArray("seen"));
        assertEquals("[]", ids(CommentReplyNotifications.findNewReplies(own, new JSONArray().put(reply("a", "UCother", "Nice")))
            .getJSONArray("added")).toString());

        JSONObject replyComment = new JSONObject(comment.toString()).put("commentId", "thread1.mine");
        JSONObject other = CommentReplyNotifications.trackComment(new JSONArray(), replyComment, 1000).getJSONObject(0);
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
            .put("channelId", "UCme").put("handle", JSONObject.NULL).put("token", "token%3D")
            .put("text", "First").put("videoTitle", "Title");
        JSONArray threads = CommentReplyNotifications.trackComment(new JSONArray(), comment, 1000);
        threads.getJSONObject(0).put("seen", new JSONArray().put("thread1.a"));
        threads = CommentReplyNotifications.trackComment(threads,
            new JSONObject(comment.toString()).put("commentId", "thread1.later").put("text", "Later").put("videoTitle", "Renamed"), 5000);
        assertEquals(1, threads.length());
        assertEquals("thread1", threads.getJSONObject(0).getString("commentId"));
        assertEquals(5000, threads.getJSONObject(0).getLong("postedAt"));
        assertEquals("[\"thread1.a\"]", threads.getJSONObject(0).getJSONArray("seen").toString());
        assertEquals("First", threads.getJSONObject(0).getString("text"));
        assertEquals("Renamed", threads.getJSONObject(0).getString("videoTitle"));
        assertEquals(0, CommentReplyNotifications.normalize(threads, 5000 + CommentReplyNotifications.TRACKING_MILLIS).size());
        // Watching it again after it expired starts from the replies it has now.
        JSONObject again = CommentReplyNotifications.trackComment(threads,
            new JSONObject(comment.toString()).put("seen", new JSONArray().put("thread1.a").put("thread1.b")),
            5000 + CommentReplyNotifications.TRACKING_MILLIS).getJSONObject(0);
        assertEquals("[\"thread1.a\",\"thread1.b\"]", again.getJSONArray("seen").toString());
    }

    @Test
    public void watchesOthersCommentsFromNowOnAndApartFromOwnOnes() throws Exception {
        JSONObject theirs = new JSONObject().put("videoId", "video1").put("threadId", "thread1").put("commentId", "thread1")
            .put("channelId", "UCthem").put("handle", "@Them").put("accountId", "UCme").put("token", "token%3D")
            .put("replyCount", 1).put("seen", new JSONArray().put("thread1.old"));
        JSONArray threads = CommentReplyNotifications.trackComment(new JSONArray(), theirs, 1000);
        JSONObject watched = threads.getJSONObject(0);
        assertEquals(false, CommentReplyNotifications.isOwnComment(watched));
        // Replies it had already are not announced, nor the account's, but its author's are.
        JSONArray replies = new JSONArray().put(reply("old", "UCx", "Old")).put(reply("author", "UCthem", "Update"))
            .put(reply("mine", "UCme", "Mine")).put(reply("new", "UCx", "New"));
        assertEquals("[\"thread1.author\",\"thread1.new\"]",
            ids(CommentReplyNotifications.findNewReplies(watched, replies).getJSONArray("added")).toString());
        // Watched while signed out, but answered after signing in
        JSONObject signedOut = new JSONObject(watched.toString()).put("accountId", "");
        assertEquals("[\"thread1.author\",\"thread1.new\"]",
            ids(CommentReplyNotifications.findNewReplies(signedOut, replies, "UCme").getJSONArray("added")).toString());

        // Their top-level comment covers the thread from the replies it had when watched.
        JSONArray replyWatch = CommentReplyNotifications.trackComment(new JSONArray(),
            new JSONObject(theirs.toString()).put("commentId", "thread1.theirs"), 1000);
        JSONObject upgraded = CommentReplyNotifications.trackComment(replyWatch,
            new JSONObject(theirs.toString()).put("seen", new JSONArray().put("thread1.old").put("thread1.since")), 2000).getJSONObject(0);
        assertEquals("thread1", upgraded.getString("commentId"));
        assertEquals("[\"thread1.old\",\"thread1.since\"]", upgraded.getJSONArray("seen").toString());

        // The account's own comment in that thread is watched apart from it.
        JSONObject mine = new JSONObject().put("videoId", "video1").put("threadId", "thread1").put("commentId", "thread1.mine")
            .put("channelId", "UCme").put("handle", "@Me").put("accountId", "UCme").put("token", "token%3D");
        threads = CommentReplyNotifications.trackComment(threads, mine, 2000);
        assertEquals(2, threads.length());
        threads = CommentReplyNotifications.untrackComment(threads, theirs);
        assertEquals(1, threads.length());
        assertEquals("UCme", threads.getJSONObject(0).getString("channelId"));
        // Comments watched before others' could be are the account's own.
        threads.getJSONObject(0).remove("accountId");
        assertEquals(true, CommentReplyNotifications.isOwnComment(threads.getJSONObject(0)));
    }
}
