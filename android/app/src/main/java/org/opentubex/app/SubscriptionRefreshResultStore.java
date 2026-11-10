package org.opentubex.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class SubscriptionRefreshResultStore {
    private static final String DIRECTORY_NAME = "subscription-refresh-results";
    // YouTube varies these per request (tracking, continuation tokens, country
    // order) even when the feed itself is unchanged.
    private static final Set<String> VOLATILE_KEYS = new HashSet<>(Arrays.asList(
        "responseContext", "trackingParams", "clickTrackingParams", "trackingParam", "loggingDirectives",
        "frameworkUpdates", "availableCountryCodes", "availableCountries", "playerParams", "params",
        "token", "targetId", "continueAction", "veCounter", "sectionIdentifier", "tag", "sequenceParams",
        "inlinePopStateEntityKey", "html5PlaybackOnesieConfig", "colorMap"
    ));
    // Per-request signatures, redirect tokens and daily avatar versions. Other
    // parameters, such as a video ID or a link's destination, are feed content.
    private static final Set<String> VOLATILE_URL_PARAMETERS = new HashSet<>(Arrays.asList(
        "pp", "rs", "sqp", "usqp", "redir_token", "continue", "days_since_epoch"
    ));
    private static final Pattern LEADING_ID = Pattern.compile("\\{\"id\":\"([0-9]{13}-[0-9a-f-]{36})\"[,}]");
    private static File indexedDirectory;
    private static SubscriptionRefreshResultIndex index;

    private SubscriptionRefreshResultStore() {}

    /** A fetched feed, serialized and fingerprinted once for every profile that subscribes to it. */
    static final class ChannelPayload {
        final String channelId;
        final String json;
        final String fingerprint;

        ChannelPayload(String channelId, JSONObject payload) {
            this.channelId = channelId;
            json = payload.toString();
            // The channel ID lets a cache clear forget only that channel's fingerprints.
            fingerprint = channelId + "\n" + fingerprint(payload);
        }
    }

    static void writeChannel(
        Context context,
        String profileId,
        String feedType,
        String channelId,
        JSONObject payload,
        long timestamp
    ) throws IOException, JSONException {
        writeChannel(context, profileId, feedType, new ChannelPayload(channelId, payload), timestamp);
    }

    static synchronized void writeChannel(
        Context context,
        String profileId,
        String feedType,
        ChannelPayload payload,
        long timestamp
    ) throws IOException, JSONException {
        String slot = profileId + "\n" + feedType + "\n" + payload.channelId;
        // An unchanged feed would only make the app import the same data again.
        // A pending result for this slot already holds that payload.
        File fingerprintFile = new File(directory(context), slotName(slot) + ".fingerprint");
        if (payload.fingerprint.equals(readFingerprint(fingerprintFile))) return;
        JSONObject result = baseResult("channel", profileId, feedType, timestamp)
            .put("channelId", payload.channelId);
        String head = result.toString();
        write(context, result.getString("id"), head.substring(0, head.length() - 1) + ",\"payload\":" + payload.json + '}', slot);
        try (FileOutputStream output = new FileOutputStream(fingerprintFile)) {
            output.write(payload.fingerprint.getBytes(StandardCharsets.UTF_8));
        } catch (IOException error) {
            // A missing fingerprint only means the next unchanged result is written again.
            fingerprintFile.delete();
        }
    }

    static synchronized void writeCompletion(
        Context context,
        String profileId,
        String feedType,
        long timestamp
    ) throws IOException, JSONException {
        write(
            context,
            baseResult("completion", profileId, feedType, timestamp),
            profileId + "\n" + feedType + "\ncompletion"
        );
    }

    static synchronized void writeFailure(
        Context context,
        String profileId,
        String feedType,
        SubscriptionRefreshRequestDiagnostic diagnostic,
        long timestamp
    ) throws IOException, JSONException {
        JSONObject result = baseResult("failure", profileId, feedType, timestamp)
            .put("diagnostic", diagnostic.toJson());
        write(context, result, profileId + "\n" + feedType + "\nfailure");
    }

    // The app's cache no longer holds what these fingerprints describe, so the
    // next refresh has to queue those feeds again. Null forgets every channel.
    // Returns false when a matching fingerprint could not be deleted.
    static synchronized boolean forgetFingerprints(Context context, Set<String> channelIds) {
        File[] fingerprints = directory(context).listFiles((dir, name) -> name.endsWith(".fingerprint"));
        if (fingerprints == null) return false;
        boolean forgotten = true;
        for (File file : fingerprints) {
            String fingerprint = readFingerprint(file);
            int end = fingerprint == null ? -1 : fingerprint.indexOf('\n');
            if ((channelIds == null || end < 0 || channelIds.contains(fingerprint.substring(0, end))) &&
                !file.delete() && file.exists()) {
                forgotten = false;
            }
        }
        return forgotten;
    }

    static synchronized void clearFailure(Context context, String profileId, String feedType) {
        File failure = new File(directory(context), slotName(profileId + "\n" + feedType + "\nfailure") + ".json");
        if (failure.delete() && index != null && failure.getParentFile().equals(indexedDirectory)) {
            index.remove(failure);
        }
    }

    static synchronized JSONObject readNext(Context context) throws IOException, JSONException {
        File file = index(context).first();
        return file == null ? null : read(file);
    }

    static synchronized boolean acknowledge(Context context, String id) throws IOException, JSONException {
        return acknowledge(context, id, false);
    }

    /**
     * @param forgetFingerprint whether the app skipped this result, so that the
     *     next refresh queues the feed again even if it is unchanged
     */
    static synchronized boolean acknowledge(Context context, String id, boolean forgetFingerprint)
        throws IOException, JSONException {
        if (id == null) return false;
        SubscriptionRefreshResultIndex pending = index(context);
        File file = pending.get(id);
        // Replacing a slot removes its old ID, so an old acknowledgement cannot
        // delete the replacement. All writes and acknowledgements hold this lock.
        if (file == null) return true;
        if (forgetFingerprint) {
            File fingerprint = new File(file.getParentFile(), file.getName().replaceFirst("\\.json$", ".fingerprint"));
            if (!fingerprint.delete() && fingerprint.exists()) return false;
        }
        if (!file.delete() && file.exists()) return false;
        pending.remove(file);
        return true;
    }

    private static JSONObject baseResult(String kind, String profileId, String feedType, long timestamp)
        throws JSONException {
        return new JSONObject()
            .put("id", createId())
            .put("kind", kind)
            .put("profileId", profileId)
            .put("feedType", feedType)
            .put("timestamp", timestamp);
    }

    private static void write(Context context, JSONObject result, String slot) throws IOException, JSONException {
        write(context, result.getString("id"), result.toString(), slot);
    }

    private static void write(Context context, String id, String json, String slot) throws IOException {
        File directory = directory(context);
        SubscriptionRefreshResultIndex pending = directory.equals(indexedDirectory) ? index : null;
        File target = new File(directory, slotName(slot) + ".json");
        File temporary = new File(directory, id + ".tmp");
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write(bytes);
            output.getFD().sync();
        }
        if (!temporary.renameTo(target)) {
            boolean removed = target.delete();
            if (removed && pending != null) pending.remove(target);
            if (!removed || !temporary.renameTo(target)) {
                temporary.delete();
                throw new IOException("Unable to commit pending refresh result");
            }
        }
        if (pending != null) pending.put(target, id);
    }

    private static SubscriptionRefreshResultIndex index(Context context) throws IOException {
        File directory = directory(context);
        if (index == null || !directory.equals(indexedDirectory)) {
            // Writes hold this lock, so any temporary file left now belongs to
            // a write that was interrupted with its process.
            File[] temporaryFiles = directory.listFiles((dir, name) -> name.endsWith(".tmp"));
            if (temporaryFiles != null) for (File file : temporaryFiles) file.delete();
            index = new SubscriptionRefreshResultIndex(directory, SubscriptionRefreshResultStore::readId);
            indexedDirectory = directory;
        }
        return index;
    }

    private static String slotName(String slot) {
        return UUID.nameUUIDFromBytes(slot.getBytes(StandardCharsets.UTF_8)).toString();
    }

    static String fingerprint(JSONObject payload) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            updateFingerprint(digest, payload);
            StringBuilder hex = new StringBuilder();
            for (byte value : digest.digest()) hex.append(String.format("%02x", value));
            return hex.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    private static void updateFingerprint(MessageDigest digest, Object value) {
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            List<String> keys = new ArrayList<>();
            for (Iterator<String> iterator = object.keys(); iterator.hasNext();) {
                String key = iterator.next();
                if (!VOLATILE_KEYS.contains(key)) keys.add(key);
            }
            Collections.sort(keys);
            digest.update((byte) '{');
            for (String key : keys) {
                Object child = object.opt(key);
                if ("url".equals(key) && child instanceof String) {
                    child = fingerprintUrl((String) child);
                    if (child == null) continue;
                }
                updateFingerprint(digest, key);
                updateFingerprint(digest, child);
            }
            digest.update((byte) '}');
        } else if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            digest.update((byte) '[');
            for (int i = 0; i < array.length(); i++) updateFingerprint(digest, array.opt(i));
            digest.update((byte) ']');
        } else {
            digest.update(JSONObject.wrap(value).toString().getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
        }
    }

    static String fingerprintUrl(String url) {
        int hostStart = url.indexOf("://");
        int hostEnd = hostStart < 0 ? -1 : url.indexOf('/', hostStart + 3);
        String host = hostStart < 0 ? "" : url.substring(hostStart + 3, hostEnd < 0 ? url.length() : hostEnd);
        // YouTube rotates thumbnail variants (oar1.jpg, hq720_3.jpg) per
        // request, while a replaced thumbnail keeps its path.
        if (host.endsWith("ytimg.com")) return null;
        int queryStart = url.indexOf('?');
        if (queryStart < 0) return url;
        StringBuilder result = new StringBuilder(url.substring(0, queryStart + 1));
        for (String parameter : url.substring(queryStart + 1).split("&")) {
            String name = parameter.split("=", 2)[0];
            if (VOLATILE_URL_PARAMETERS.contains(name)) continue;
            if (result.charAt(result.length() - 1) != '?') result.append('&');
            result.append(parameter);
        }
        // A URL whose parameters were all volatile matches the same URL without them.
        if (result.charAt(result.length() - 1) == '?') result.setLength(result.length() - 1);
        return result.toString();
    }

    private static String readFingerprint(File file) {
        if (!file.isFile()) return null;
        try {
            return new String(readBytes(file), StandardCharsets.UTF_8);
        } catch (IOException error) {
            return null;
        }
    }

    private static String createId() {
        return String.format("%013d-%s", System.currentTimeMillis(), UUID.randomUUID());
    }

    /**
     * Results can hold large responses. Their writer puts the ID first, so read only
     * the start of the file to index it, and parse the rest when it is imported.
     */
    static String readId(File file) throws IOException {
        byte[] head = new byte[(int) Math.min(file.length(), 128)];
        try (FileInputStream input = new FileInputStream(file)) {
            int offset = 0;
            while (offset < head.length) {
                int count = input.read(head, offset, head.length - offset);
                if (count < 0) break;
                offset += count;
            }
            Matcher id = LEADING_ID.matcher(new String(head, 0, offset, StandardCharsets.UTF_8));
            if (id.lookingAt()) return id.group(1);
        }
        try {
            return read(file).getString("id");
        } catch (JSONException error) {
            throw new IOException("Invalid pending refresh result", error);
        }
    }

    private static JSONObject read(File file) throws IOException, JSONException {
        return new JSONObject(new String(readBytes(file), StandardCharsets.UTF_8));
    }

    private static byte[] readBytes(File file) throws IOException {
        byte[] bytes;
        try (FileInputStream input = new FileInputStream(file)) {
            bytes = new byte[(int) file.length()];
            int offset = 0;
            while (offset < bytes.length) {
                int count = input.read(bytes, offset, bytes.length - offset);
                if (count < 0) break;
                offset += count;
            }
            if (offset != bytes.length) throw new IOException("Incomplete pending refresh result");
        }
        return bytes;
    }

    private static File directory(Context context) {
        File directory = new File(context.getFilesDir(), DIRECTORY_NAME);
        if (!directory.exists()) directory.mkdirs();
        return directory;
    }
}
