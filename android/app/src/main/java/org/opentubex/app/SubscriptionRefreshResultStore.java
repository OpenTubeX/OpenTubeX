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

final class SubscriptionRefreshResultStore {
    private static final String DIRECTORY_NAME = "subscription-refresh-results";
    // YouTube varies these per request (tracking, redirect tokens, signed URLs,
    // country order) even when the feed itself is unchanged.
    private static final Set<String> VOLATILE_KEYS = new HashSet<>(Arrays.asList(
        "responseContext", "trackingParams", "clickTrackingParams", "trackingParam", "loggingDirectives",
        "frameworkUpdates", "availableCountryCodes", "availableCountries", "playerParams", "params",
        "token", "targetId", "continueAction", "veCounter", "sectionIdentifier", "tag", "sequenceParams",
        "inlinePopStateEntityKey", "html5PlaybackOnesieConfig", "colorMap", "url"
    ));
    private static File indexedDirectory;
    private static SubscriptionRefreshResultIndex index;

    private SubscriptionRefreshResultStore() {}

    static synchronized void writeChannel(
        Context context,
        String profileId,
        String feedType,
        String channelId,
        JSONObject payload,
        long timestamp
    ) throws IOException, JSONException {
        String slot = profileId + "\n" + feedType + "\n" + channelId;
        // An unchanged feed would only make the app import the same data again.
        // A pending result for this slot already holds that payload.
        File fingerprintFile = new File(directory(context), slotName(slot) + ".fingerprint");
        String fingerprint = fingerprint(payload);
        if (fingerprint.equals(readFingerprint(fingerprintFile))) return;
        JSONObject result = baseResult("channel", profileId, feedType, timestamp)
            .put("channelId", channelId)
            .put("payload", payload);
        write(context, result, slot);
        try (FileOutputStream output = new FileOutputStream(fingerprintFile)) {
            output.write(fingerprint.getBytes(StandardCharsets.UTF_8));
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
        if (id == null) return false;
        SubscriptionRefreshResultIndex pending = index(context);
        File file = pending.get(id);
        // Replacing a slot removes its old ID, so an old acknowledgement cannot
        // delete the replacement. All writes and acknowledgements hold this lock.
        if (file == null) return true;
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
        File directory = directory(context);
        SubscriptionRefreshResultIndex pending = directory.equals(indexedDirectory) ? index : null;
        String id = result.getString("id");
        File target = new File(directory, slotName(slot) + ".json");
        File temporary = new File(directory, id + ".tmp");
        byte[] bytes = result.toString().getBytes(StandardCharsets.UTF_8);
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
            index = new SubscriptionRefreshResultIndex(directory, file -> {
                try {
                    return read(file).getString("id");
                } catch (JSONException error) {
                    throw new IOException("Invalid pending refresh result", error);
                }
            });
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
                updateFingerprint(digest, key);
                updateFingerprint(digest, object.opt(key));
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
