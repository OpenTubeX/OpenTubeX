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
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Announces replies to watched comments: those the YouTube account posted in
 * the app, and any others the user watches, and hearts on the account's own. Android
 * checks them here, while the app is visible and, if it may refresh
 * subscriptions then, while it is hidden or closed. Mirrors
 * src/commentReplyTracking.js and fetchThread in commentReplyNotifications.js.
 */
final class CommentReplyNotifications {
    private static final String PREFERENCES = "comment-replies";
    private static final String CONFIGURATION_KEY = "configuration";
    private static final String STATE_FILE = "comment-reply-threads.json";
    static final String WORK_NAME = "comment-reply-checks";
    static final String FEED_TYPE = "comment-reply";
    static final String HEART_FEED_TYPE = "comment-heart";
    // WorkManager's shortest period, like the other platforms' checks
    private static final long CHECK_INTERVAL_MINUTES = 15;
    static final long TRACKING_MILLIS = 30L * 24 * 60 * 60 * 1000;
    static final int TRACKING_LIMIT = 50;
    private static final int SEEN_REPLY_LIMIT = 500;
    // An author's comments per thread whose hearts are checked, as each may need a request of its own.
    static final int HEART_COMMENT_LIMIT = 10;
    // Reply pages hold 10 replies each.
    static final int MAX_REPLY_PAGES = 10;
    private static final int TIMEOUT_MILLIS = 15_000;
    private static final int MAXIMUM_RESPONSE_BYTES = 4 * 1024 * 1024;
    private static final Pattern ID = Pattern.compile("[\\w-]+");
    // Base64 continuations, URL-encoded or not
    private static final Pattern TOKEN = Pattern.compile("[\\w%.+/=-]+");
    private static final String HANDLE_CHARACTERS = "\\p{L}\\p{M}\\p{N}_\\-·";
    private static final Pattern HEART_HANDLE = Pattern.compile("@[" + HANDLE_CHARACTERS + ".]*[" + HANDLE_CHARACTERS + "]");

    private CommentReplyNotifications() {}

    /** Whether notifications of a feed type are about watched comments. */
    static boolean isFeedType(String feedType) {
        return FEED_TYPE.equals(feedType) || HEART_FEED_TYPE.equals(feedType);
    }

    /**
     * Saves how to check and announce replies. Checks run periodically while
     * enabled; the worker skips them while the app is closed unless it may
     * refresh subscriptions then.
     */
    static synchronized void configure(Context context, JSONObject configuration) {
        preferences(context).edit().putString(CONFIGURATION_KEY, configuration.toString()).commit();
        WorkManager work = WorkManager.getInstance(context);
        if (configuration.optBoolean("enabled")) {
            work.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP,
                new PeriodicWorkRequest.Builder(CommentReplyWorker.class, CHECK_INTERVAL_MINUTES, TimeUnit.MINUTES)
                    .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .build());
        } else {
            work.cancelUniqueWork(WORK_NAME);
        }
    }

    /** Watches a comment for replies. */
    static synchronized void track(Context context, JSONObject comment) throws Exception {
        File file = stateFile(context);
        JSONObject state = readState(file);
        state.put("threads", trackComment(threads(state), comment, System.currentTimeMillis()));
        writeState(file, state);
    }

    /** Stops watching a comment, with its author's other comments in the thread. */
    static synchronized void untrack(Context context, JSONObject comment) throws Exception {
        File file = stateFile(context);
        JSONObject state = readState(file);
        state.put("threads", untrackComment(threads(state), comment));
        writeState(file, state);
    }

    /** The watched threads, last active first, for the list of watched comments. */
    static synchronized JSONArray list(Context context) throws Exception {
        return new JSONArray(normalize(threads(readState(stateFile(context))), System.currentTimeMillis()));
    }

    /** Counts opening a thread as activity of the comments watched in it. */
    static synchronized void touch(Context context, String videoId, String threadId) throws Exception {
        File file = stateFile(context);
        JSONObject state = readState(file);
        JSONArray threads = markThreadOpened(threads(state), videoId, threadId, System.currentTimeMillis());
        if (threads == null) return;
        state.put("threads", threads);
        writeState(file, state);
    }



    static boolean closedAppAllowed(Context context) throws JSONException {
        return configuration(context).optBoolean("closedApp");
    }

    /** Checks every watched thread, for the worker. */
    static void check(Context context) throws Exception {
        JSONObject configuration = configuration(context);
        if (!configuration.optBoolean("enabled")) return;
        JSONObject request = configuration.optJSONObject("request");
        if (request == null) return;
        // Watches expire from when the check started, so a reply found after one
        // ran out during the check still keeps it watched.
        long startedAt = System.currentTimeMillis();
        List<JSONObject> threads;
        synchronized (CommentReplyNotifications.class) {
            threads = normalize(threads(readState(stateFile(context))), startedAt);
        }
        // Comments of several authors in a thread can be watched, and a reply can answer more than one.
        Set<String> announced = new HashSet<>();
        for (JSONObject thread : threads) {
            if (!configuration(context).optBoolean("enabled")) return;
            try {
                observe(context, thread, fetchThread(request, thread), announced, startedAt);
            } catch (Exception error) {
                // One thread must not stop the checks of the others.
                android.util.Log.w("OpenTubeXReplies", "Unable to check a comment for replies", error);
            }
        }
    }

    /**
     * Announces the new replies of a checked thread before it saves them as
     * seen, so a check that stops in between repeats a reply rather than losing it.
     * @param result null when the thread is gone
     * @param startedAt when the check started, which the watch must have outlasted
     */
    private static void observe(Context context, JSONObject fetched, JSONObject result, Set<String> announced, long startedAt) throws Exception {
        // The entry as it is now, as the user may have stopped watching it while it loaded.
        JSONObject checked = null;
        synchronized (CommentReplyNotifications.class) {
            for (JSONObject thread : normalize(threads(readState(stateFile(context))), startedAt)) {
                if (isSameComment(thread, fetched)) checked = thread;
            }
        }
        if (checked == null) return;
        JSONObject configuration = configuration(context);
        String videoId = checked.getString("videoId");
        JSONArray seen = checked.optJSONArray("seen");
        boolean active = false;
        if (result != null && result.has("replies")) {
            JSONObject found = findNewReplies(checked, result.getJSONArray("replies"), configuration.optString("accountId"));
            JSONArray added = found.getJSONArray("added");
            // Replies left when notifications turn off count as seen too.
            for (int index = 0; index < added.length() && configuration(context).optBoolean("enabled"); index++) {
                JSONObject reply = added.getJSONObject(index);
                if (announced.add(videoId + "/" + reply.optString("id"))) announce(context, configuration, checked, reply);
            }
            seen = found.getJSONArray("seen");
            active = found.optBoolean("active");
        }
        JSONObject hearts = result == null || !result.has("hearts") ? new JSONObject() : result.getJSONObject("hearts");
        JSONObject checkedHearts = checkHearts(checked, hearts);
        // A new heart counts as activity, also on others' comments.
        active |= checkedHearts.getBoolean("active");
        JSONArray announcedHearts = checkedHearts.getJSONArray("announce");
        for (int index = 0; index < announcedHearts.length() && configuration(context).optBoolean("enabled"); index++) {
            announceHeart(context, configuration, checked, announcedHearts.getJSONObject(index));
        }
        synchronized (CommentReplyNotifications.class) {
            File file = stateFile(context);
            JSONObject state = readState(file);
            JSONArray threads = threads(state);
            JSONArray kept = new JSONArray();
            for (int index = 0; index < threads.length(); index++) {
                JSONObject thread = threads.getJSONObject(index);
                boolean same = isSameComment(thread, checked);
                if (!same) kept.put(thread);
                else if (result != null) {
                    thread.put("replyCount", result.getInt("replyCount")).put("seen", seen == null ? new JSONArray() : seen);
                    // Applied to the entry as it is now, which may watch more comments meanwhile.
                    thread.put("comments", checkHearts(thread, hearts).getJSONArray("comments"));
                    if (active) thread.put("activeAt", System.currentTimeMillis());
                    kept.put(thread);
                }
            }
            state.put("threads", kept);
            writeState(file, state);
        }
    }

    private static void announce(Context context, JSONObject configuration, JSONObject thread, JSONObject reply) throws JSONException {
        String videoId = thread.getString("videoId");
        String author = reply.optString("author");
        String handle = thread.isNull("handle") ? "" : thread.optString("handle");
        String title = isOwnComment(thread)
            ? configuration.optString("title", "{author}").replace("{author}", author.isEmpty() ? "?" : author)
            : configuration.optString("otherTitle", "{author}")
                .replace("{commentAuthor}", handle.isEmpty() ? "?" : handle)
                .replace("{author}", author.isEmpty() ? "?" : author);
        String template = configuration.optString("thumbnail", "");
        String thumbnail = template.startsWith("https://") ? template.replace("%VIDEO%", videoId) : null;
        UploadNotifications.deliver(context, FEED_TYPE, videoId + "/" + reply.getString("id"), false, title,
            reply.optString("text"), thumbnail, "both".equals(configuration.optString("mode")), false);
    }

    /** @param heart the hearted comment's `id`, with the `author` and `text` that parseHeart reads */
    private static void announceHeart(Context context, JSONObject configuration, JSONObject thread, JSONObject heart) {
        String videoId = thread.optString("videoId");
        String author = heart.optString("author");
        String title = configuration.optString("heartTitle", "{author}").replace("{author}", author.isEmpty() ? "?" : author);
        String template = configuration.optString("thumbnail", "");
        String thumbnail = template.startsWith("https://") ? template.replace("%VIDEO%", videoId) : null;
        UploadNotifications.deliver(context, HEART_FEED_TYPE, videoId + "/" + heart.optString("id"), false, title,
            heart.optString("text"), thumbnail, "both".equals(configuration.optString("mode")), false);
    }

    /** The full ID of the watched comment, `threadId.replyId` for a reply. */
    static String watchedCommentId(JSONObject thread) {
        String threadId = thread.optString("threadId");
        String commentId = thread.optString("commentId");
        // Posted replies may lack the `threadId.` that loaded ones start with.
        return commentId.equals(threadId) || commentId.startsWith(threadId + ".") ? commentId : threadId + "." + commentId;
    }

    /**
     * The author's comments watched in a thread, whose hearts are checked: the
     * watched one first, then the newest others, each with its `id`, the `token`
     * that links it, and whether it is `hearted`, which a comment watched without
     * its heart lacks until its first check. Entries watched before hearts were
     * checked lack the list, which then holds the watched comment.
     */
    static JSONArray heartComments(JSONObject thread) throws JSONException {
        JSONArray comments = thread.optJSONArray("comments");
        return comments != null ? comments : new JSONArray().put(new JSONObject().put("id", watchedCommentId(thread)));
    }

    /**
     * Loads the reply count of a thread, and its replies, oldest first, unless the
     * count did not change, and under `hearts` whether its watched comments are
     * hearted, by their IDs, without those it did not find. Returns null when the
     * thread is gone.
     */
    private static JSONObject fetchThread(JSONObject request, JSONObject thread) throws Exception {
        String threadId = thread.getString("threadId");
        JSONArray comments = heartComments(thread);
        JSONObject hearts = new JSONObject();
        JSONObject first = post(request, thread.getString("token"));
        JSONObject parsed = parseThread(first, threadId);
        if (parsed == null) return null;
        int replyCount = parsed.getInt("replyCount");
        // A linked reply comes with its thread, though comments watched before
        // hearts were checked link their thread, which then lacks a watched reply.
        readHearts(first, comments, hearts);
        JSONObject result = new JSONObject().put("replyCount", replyCount).put("hearts", hearts);
        String token = parsed.optString("repliesToken", null);
        if (replyCount != thread.optInt("replyCount", -1) && token != null) {
            JSONArray replies = new JSONArray();
            for (int page = 0; token != null && page < MAX_REPLY_PAGES; page++) {
                JSONObject response = post(request, token);
                // Reply pages come with the hearts of their replies.
                readHearts(response, comments, hearts);
                JSONObject replyPage = parseReplies(response);
                JSONArray pageReplies = replyPage.getJSONArray("replies");
                for (int index = 0; index < pageReplies.length(); index++) replies.put(pageReplies.get(index));
                token = replyPage.optString("nextToken", null);
            }
            result.put("replies", replies);
        }
        // Own comments not found so far each need a request that links them.
        for (JSONObject comment : commentsToLink(thread, hearts)) {
            try {
                readHearts(post(request, comment.getString("token")), comments, hearts);
            } catch (Exception error) {
                android.util.Log.w("OpenTubeXReplies", "Unable to check a comment for a heart", error);
            }
        }
        return result;
    }

    /** Adds the hearts of the comments that a response includes, unless already found. */
    static void readHearts(JSONObject response, JSONArray comments, JSONObject hearts) throws JSONException {
        for (int index = 0; index < comments.length(); index++) {
            JSONObject comment = comments.optJSONObject(index);
            String id = comment == null ? "" : comment.optString("id");
            if (!id.isEmpty() && !hearts.has(id)) hearts.putOpt(id, parseHeart(response, id));
        }
    }

    /**
     * The comments whose hearts need a request that links each: the account's
     * own ones that the responses so far lacked, except the watched comment,
     * which the first request links. Hearts on others' comments are not announced.
     */
    static List<JSONObject> commentsToLink(JSONObject thread, JSONObject hearts) throws JSONException {
        List<JSONObject> linked = new ArrayList<>();
        if (!isOwnComment(thread)) return linked;
        JSONArray comments = heartComments(thread);
        String watchedId = watchedCommentId(thread);
        for (int index = 0; index < comments.length(); index++) {
            JSONObject comment = comments.optJSONObject(index);
            String id = comment == null ? "" : comment.optString("id");
            if (id.isEmpty() || id.equals(watchedId) || hearts.has(id) || !TOKEN.matcher(comment.optString("token")).matches()) continue;
            linked.add(comment);
        }
        return linked;
    }

    /**
     * Which of a watched entry's comments got a new creator heart, to announce
     * only for the account's own comments, and not on the first check of a
     * comment watched without its heart, as it may be old.
     * @param hearts what parseHeart read, by comment ID, without the comments the responses lacked
     * @return under `announce` the hearts to announce, each with its comment's `id`, under `active`
     *     whether any is new and so counts as activity, also for others' comments, and the comments to save under `comments`
     */
    static JSONObject checkHearts(JSONObject thread, JSONObject hearts) throws JSONException {
        boolean own = isOwnComment(thread);
        JSONArray comments = heartComments(thread);
        JSONArray checked = new JSONArray();
        JSONArray announce = new JSONArray();
        boolean active = false;
        for (int index = 0; index < comments.length(); index++) {
            JSONObject comment = comments.optJSONObject(index);
            if (comment == null) continue;
            String id = comment.optString("id");
            JSONObject heart = hearts.optJSONObject(id);
            if (heart == null) {
                checked.put(comment);
                continue;
            }
            boolean hearted = heart.optBoolean("hearted");
            // Announced once, even if the heart is taken back and given again.
            if (hearted && comment.has("hearted") && !comment.optBoolean("hearted")) {
                active = true;
                if (own) announce.put(new JSONObject(heart.toString()).put("id", id));
            }
            checked.put(new JSONObject(comment.toString()).put("hearted", hearted || comment.optBoolean("hearted")));
        }
        return new JSONObject().put("announce", announce).put("active", active).put("comments", checked);
    }

    /**
     * Reads the linked thread of a comments response: its reply count and the
     * token of its first reply page. Returns null without the thread.
     */
    static JSONObject parseThread(JSONObject response, String threadId) throws JSONException {
        JSONObject entities = commentEntities(response);
        JSONObject entity = entities.optJSONObject(threadId);
        if (entity == null) return null;
        JSONObject result = new JSONObject().put("replyCount", parseCount(entity));
        for (Object item : find(response, "commentThreadRenderer")) {
            JSONObject renderer = (JSONObject) item;
            JSONObject viewModel = renderer.optJSONObject("commentViewModel");
            viewModel = viewModel == null ? null : viewModel.optJSONObject("commentViewModel");
            if (viewModel == null || !threadId.equals(viewModel.optString("commentId"))) continue;
            List<Object> commands = find(renderer.optJSONObject("replies"), "continuationCommand");
            if (!commands.isEmpty()) result.putOpt("repliesToken", token((JSONObject) commands.get(0)));
            break;
        }
        return result;
    }

    /**
     * Reads whether a comment is hearted from a comments response that links
     * it, which includes it also when it is a reply, or from a reply page.
     * Returns null without the comment; otherwise `author` is the handle of the
     * creator who hearted it, if known, and `text` the comment's.
     */
    static JSONObject parseHeart(JSONObject response, String commentId) throws JSONException {
        JSONObject entity = commentEntities(response).optJSONObject(commentId);
        JSONObject properties = entity == null ? null : entity.optJSONObject("properties");
        String stateKey = properties == null ? "" : properties.optString("toolbarStateKey");
        if (stateKey.isEmpty()) return null;
        for (Object item : find(response, "engagementToolbarStateEntityPayload")) {
            JSONObject state = (JSONObject) item;
            if (!stateKey.equals(state.optString("key"))) continue;
            JSONObject toolbar = entity.optJSONObject("toolbar");
            // The tooltip reads like "❤ by @handle", in the language of the response.
            Matcher handle = HEART_HANDLE.matcher(toolbar == null ? "" : toolbar.optString("heartActiveTooltip"));
            return new JSONObject()
                .put("hearted", "TOOLBAR_HEART_STATE_HEARTED".equals(state.optString("heartState")))
                .put("author", handle.find() ? handle.group() : "")
                .put("text", text(entity));
        }
        return null;
    }

    /** Reads a reply page: its replies in order, and the token of the next page. */
    static JSONObject parseReplies(JSONObject response) throws JSONException {
        JSONObject entities = commentEntities(response);
        JSONArray replies = new JSONArray();
        String nextToken = null;
        for (Object item : find(response, "continuationItems")) {
            if (!(item instanceof JSONArray)) continue;
            JSONArray items = (JSONArray) item;
            for (int index = 0; index < items.length(); index++) {
                JSONObject entry = items.optJSONObject(index);
                if (entry == null) continue;
                // YouTube serves replies flat, holding the view model directly, or
                // nested, wrapping it in a thread like top-level comments.
                JSONObject thread = entry.optJSONObject("commentThreadRenderer");
                JSONObject viewModel = (thread != null ? thread : entry).optJSONObject("commentViewModel");
                if (viewModel != null && viewModel.has("commentViewModel")) viewModel = viewModel.optJSONObject("commentViewModel");
                if (viewModel != null) {
                    JSONObject entity = entities.optJSONObject(viewModel.optString("commentId"));
                    if (entity != null) replies.put(reply(entity));
                } else if (entry.has("continuationItemRenderer")) {
                    List<Object> commands = find(entry, "continuationCommand");
                    if (!commands.isEmpty()) nextToken = token((JSONObject) commands.get(0));
                }
            }
        }
        return new JSONObject().put("replies", replies).putOpt("nextToken", nextToken);
    }

    private static JSONObject reply(JSONObject entity) throws JSONException {
        JSONObject properties = entity.getJSONObject("properties");
        JSONObject author = entity.optJSONObject("author");
        return new JSONObject()
            .put("id", properties.getString("commentId"))
            .put("authorId", author == null ? "" : author.optString("channelId"))
            .put("author", author == null ? "" : author.optString("displayName"))
            .put("text", text(entity));
    }

    private static String text(JSONObject entity) {
        JSONObject properties = entity.optJSONObject("properties");
        JSONObject content = properties == null ? null : properties.optJSONObject("content");
        // Mentions come with extra spaces, zero-width spaces, and bidirectional isolates around them.
        return (content == null ? "" : content.optString("content"))
            .replaceAll("[\\u200B-\\u200D\\u2066-\\u2069]", "").replaceAll("\\s+", " ").trim();
    }

    private static int parseCount(JSONObject entity) {
        JSONObject toolbar = entity.optJSONObject("toolbar");
        String digits = toolbar == null ? "" : toolbar.optString("replyCount").replaceAll("\\D", "");
        return digits.isEmpty() ? 0 : Integer.parseInt(digits);
    }

    private static JSONObject commentEntities(JSONObject response) {
        JSONObject entities = new JSONObject();
        for (Object item : find(response, "commentEntityPayload")) {
            JSONObject entity = (JSONObject) item;
            JSONObject properties = entity.optJSONObject("properties");
            String id = properties == null ? "" : properties.optString("commentId");
            if (!id.isEmpty()) {
                try {
                    entities.put(id, entity);
                } catch (JSONException ignored) {
                    // Only a null key fails.
                }
            }
        }
        return entities;
    }

    private static String token(JSONObject command) {
        String token = command.optString("token", "");
        return TOKEN.matcher(token).matches() ? token : null;
    }

    /** Every object or array stored under the key, in document order. */
    private static List<Object> find(Object value, String key) {
        List<Object> found = new ArrayList<>();
        collect(value, key, found);
        return found;
    }

    private static void collect(Object value, String key, List<Object> found) {
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            JSONArray names = object.names();
            if (names == null) return;
            for (int index = 0; index < names.length(); index++) {
                String name = names.optString(index);
                Object child = object.opt(name);
                if (name.equals(key) && (child instanceof JSONObject || child instanceof JSONArray)) found.add(child);
                else collect(child, key, found);
            }
        } else if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int index = 0; index < array.length(); index++) collect(array.opt(index), key, found);
        }
    }

    private static JSONObject post(JSONObject request, String token) throws Exception {
        URL url = new URL(request.getString("url"));
        if (!url.getProtocol().equals("https")) throw new IOException("Reply checks require HTTPS");
        HttpURLConnection connection = (HttpURLConnection) AndroidProxy.openConnection(url);
        connection.setConnectTimeout(TIMEOUT_MILLIS);
        connection.setReadTimeout(TIMEOUT_MILLIS);
        connection.setInstanceFollowRedirects(false);
        try {
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            byte[] body = request.getString("body").replace("%CONTINUATION%", token).getBytes(StandardCharsets.UTF_8);
            try (OutputStream output = connection.getOutputStream()) { output.write(body); }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IOException("HTTP " + status);
            try (InputStream input = connection.getInputStream()) {
                java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (output.size() + count > MAXIMUM_RESPONSE_BYTES) throw new IOException("Comment response is too large");
                    output.write(buffer, 0, count);
                }
                return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
            }
        } finally {
            connection.disconnect();
        }
    }

    /** When a watched comment was last active, which its watching follows. */
    static long lastActivity(JSONObject thread) {
        return thread.optLong("activeAt", thread.optLong("postedAt"));
    }

    /** Keeps the valid threads still watched, last active first. */
    static List<JSONObject> normalize(JSONArray threads, long now) {
        List<JSONObject> kept = new ArrayList<>();
        for (int index = 0; index < threads.length(); index++) {
            JSONObject thread = threads.optJSONObject(index);
            if (thread == null || !ID.matcher(thread.optString("videoId")).matches() ||
                !ID.matcher(thread.optString("threadId")).matches() || thread.optString("commentId").isEmpty() ||
                !TOKEN.matcher(thread.optString("token")).matches() ||
                now - lastActivity(thread) >= TRACKING_MILLIS) continue;
            kept.add(thread);
        }
        kept.sort((left, right) -> Long.compare(lastActivity(right), lastActivity(left)));
        return kept.size() > TRACKING_LIMIT ? new ArrayList<>(kept.subList(0, TRACKING_LIMIT)) : kept;
    }

    /** Whether a watched comment is the account's own. */
    static boolean isOwnComment(JSONObject thread) {
        String channelId = thread.optString("channelId");
        String accountId = thread.has("accountId") ? thread.optString("accountId") : channelId;
        return !accountId.isEmpty() && accountId.equals(channelId);
    }

    /** Whether two entries watch the same author's comments in the same thread. */
    static boolean isSameComment(JSONObject left, JSONObject right) {
        return left.optString("videoId").equals(right.optString("videoId")) &&
            left.optString("threadId").equals(right.optString("threadId")) &&
            left.optString("channelId").equals(right.optString("channelId"));
    }

    /**
     * Watches a comment for replies, until 30 days pass without activity: being
     * watched, a new reply or heart, or being opened. Each author's comments in
     * a thread are watched together, from the earliest one or from their
     * top-level comment, which covers the whole thread.
     */
    static JSONArray trackComment(JSONArray threads, JSONObject comment, long now) throws JSONException {
        String threadId = comment.getString("threadId");
        String commentId = comment.getString("commentId");
        JSONObject tracked = null;
        List<JSONObject> others = new ArrayList<>();
        // An expired watch does not carry over, so watching again starts from now.
        for (JSONObject thread : normalize(threads, now)) {
            if (tracked == null && isSameComment(thread, comment)) {
                tracked = thread;
            } else {
                others.add(thread);
            }
        }
        // Read before a top-level comment replaces the watched one.
        JSONArray previous = tracked == null ? new JSONArray() : heartComments(tracked);
        if (tracked == null) {
            JSONArray seen = comment.optJSONArray("seen");
            JSONArray keptSeen = new JSONArray();
            if (seen != null) {
                for (int index = Math.max(0, seen.length() - SEEN_REPLY_LIMIT); index < seen.length(); index++) {
                    keptSeen.put(seen.optString(index));
                }
            }
            tracked = new JSONObject()
                .put("videoId", comment.getString("videoId"))
                .put("threadId", threadId)
                .put("commentId", commentId)
                .put("channelId", comment.optString("channelId"))
                .put("handle", comment.isNull("handle") ? JSONObject.NULL : comment.optString("handle"))
                .putOpt("accountId", comment.has("accountId") ? comment.optString("accountId") : null)
                .put("token", comment.getString("token"))
                .put("replyCount", comment.optInt("replyCount", -1))
                .put("seen", keptSeen)
                .put("text", comment.optString("text"));
        } else {
            // The text stays the watched comment's. A top-level comment watches the
            // whole thread, starting from the replies it had when watched.
            if (commentId.equals(threadId) && !threadId.equals(tracked.optString("commentId"))) {
                Set<String> seen = new LinkedHashSet<>();
                for (JSONArray ids : new JSONArray[] { tracked.optJSONArray("seen"), comment.optJSONArray("seen") }) {
                    if (ids != null) for (int index = 0; index < ids.length(); index++) seen.add(ids.optString(index));
                }
                List<String> all = new ArrayList<>(seen);
                tracked.put("commentId", commentId).put("text", comment.optString("text"))
                    .put("seen", new JSONArray(all.subList(Math.max(0, all.size() - SEEN_REPLY_LIMIT), all.size())))
                    // The token links the watched comment, so its heart can be checked.
                    .put("token", comment.getString("token"));
            }
            String accountId = comment.optString("accountId");
            if (!accountId.isEmpty() && tracked.optString("accountId").isEmpty()) tracked.put("accountId", accountId);
        }
        String videoTitle = comment.optString("videoTitle");
        if (!videoTitle.isEmpty()) tracked.put("videoTitle", videoTitle);
        tracked.put("postedAt", now).put("activeAt", now);
        JSONObject added = new JSONObject().put("id", watchedCommentId(comment)).put("token", comment.getString("token"))
            .putOpt("hearted", comment.has("hearted") ? comment.optBoolean("hearted") : null);
        tracked.put("comments", addComment(previous, watchedCommentId(tracked), added));
        JSONArray all = new JSONArray().put(tracked);
        for (JSONObject thread : others) all.put(thread);
        return new JSONArray(normalize(all, now));
    }

    /**
     * Adds a comment to an entry's comments, keeping a heart state already
     * known, so watching it again does not announce an old heart.
     * @param watchedId the full ID of the watched comment, which stays first
     */
    private static JSONArray addComment(JSONArray comments, String watchedId, JSONObject added) throws JSONException {
        JSONObject watched = null;
        List<JSONObject> others = new ArrayList<>();
        for (int index = 0; index < comments.length(); index++) {
            JSONObject comment = comments.optJSONObject(index);
            if (comment == null) continue;
            String id = comment.optString("id");
            if (id.equals(added.getString("id"))) {
                if (comment.has("hearted")) added.put("hearted", comment.optBoolean("hearted"));
            } else if (id.equals(watchedId)) {
                watched = comment;
            } else {
                others.add(comment);
            }
        }
        if (added.getString("id").equals(watchedId)) watched = added;
        else others.add(added);
        JSONArray kept = new JSONArray().put(watched == null ? new JSONObject().put("id", watchedId) : watched);
        for (int index = Math.max(0, others.size() - (HEART_COMMENT_LIMIT - 1)); index < others.size(); index++) kept.put(others.get(index));
        return kept;
    }

    /**
     * Counts opening a thread as activity of the comments watched in it.
     * @return null when none of them is watched
     */
    static JSONArray markThreadOpened(JSONArray threads, String videoId, String threadId, long now) throws JSONException {
        // An expired watch stays expired.
        List<JSONObject> kept = normalize(threads, now);
        boolean found = false;
        for (JSONObject thread : kept) {
            if (thread.optString("videoId").equals(videoId) && thread.optString("threadId").equals(threadId)) {
                thread.put("activeAt", now);
                found = true;
            }
        }
        return found ? new JSONArray(normalize(new JSONArray(kept), now)) : null;
    }

    /** Stops watching a comment, with its author's other comments in the thread. */
    static JSONArray untrackComment(JSONArray threads, JSONObject comment) throws JSONException {
        JSONArray kept = new JSONArray();
        for (int index = 0; index < threads.length(); index++) {
            JSONObject thread = threads.optJSONObject(index);
            if (thread != null && !isSameComment(thread, comment)) kept.put(thread);
        }
        return kept;
    }

    /**
     * The replies to announce, except the account's own: for a top-level
     * comment, every reply in its thread, otherwise those that follow the
     * comment and mention its author's handle.
     * @return the new replies under `added`, the replies seen so far under `seen`, and under `active`
     *     whether any new reply counts as activity: one announced, or one of the account's that follows the comment
     */
    static JSONObject findNewReplies(JSONObject thread, JSONArray replies) throws JSONException {
        return findNewReplies(thread, replies, "");
    }

    /** @param signedInId the channel signed in now, which may differ from the one it was watched with */
    static JSONObject findNewReplies(JSONObject thread, JSONArray replies, String signedInId) throws JSONException {
        String threadId = thread.getString("threadId");
        String commentId = thread.getString("commentId");
        boolean wholeThread = commentId.equals(threadId);
        int start = 0;
        if (!wholeThread) {
            // Without the watched reply, no reply is known to follow it.
            start = replies.length();
            for (int index = 0; index < replies.length(); index++) {
                String id = replies.getJSONObject(index).optString("id");
                if (id.equals(commentId) || id.equals(threadId + "." + commentId)) {
                    start = index + 1;
                    break;
                }
            }
        }
        String handle = thread.isNull("handle") ? "" : thread.optString("handle");
        // The whole handle, which may end a sentence with a period.
        Pattern mention = handle.isEmpty() ? null : Pattern.compile(
            "(?<![" + HANDLE_CHARACTERS + ".])" + Pattern.quote(handle) +
                "(?![" + HANDLE_CHARACTERS + "]|\\.[" + HANDLE_CHARACTERS + "])",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
        Set<String> seen = new LinkedHashSet<>();
        JSONArray previous = thread.optJSONArray("seen");
        if (previous != null) for (int index = 0; index < previous.length(); index++) seen.add(previous.optString(index));
        Set<String> alreadySeen = new LinkedHashSet<>(seen);
        String accountId = thread.has("accountId") ? thread.optString("accountId") : thread.optString("channelId");
        JSONArray added = new JSONArray();
        boolean ownReply = false;
        for (int index = 0; index < replies.length(); index++) {
            JSONObject reply = replies.getJSONObject(index);
            String id = reply.optString("id");
            seen.add(id);
            if (index < start || alreadySeen.contains(id)) continue;
            String authorId = reply.optString("authorId");
            if ((!accountId.isEmpty() && accountId.equals(authorId)) || (!signedInId.isEmpty() && signedInId.equals(authorId))) {
                ownReply = true;
                continue;
            }
            Matcher matcher = mention == null ? null : mention.matcher(reply.optString("text"));
            if (wholeThread || (matcher != null && matcher.find())) added.put(reply);
        }
        List<String> all = new ArrayList<>(seen);
        JSONArray kept = new JSONArray();
        for (int index = Math.max(0, all.size() - SEEN_REPLY_LIMIT); index < all.size(); index++) kept.put(all.get(index));
        return new JSONObject().put("added", added).put("seen", kept).put("active", ownReply || added.length() > 0);
    }

    private static JSONArray threads(JSONObject state) {
        JSONArray threads = state.optJSONArray("threads");
        return threads == null ? new JSONArray() : threads;
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
