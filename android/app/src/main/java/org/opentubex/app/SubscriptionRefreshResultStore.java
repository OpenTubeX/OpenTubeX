package org.opentubex.app;

import android.content.Context;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

final class SubscriptionRefreshResultStore {
    private static final String DIRECTORY_NAME = "subscription-refresh-results";
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
        JSONObject result = baseResult("channel", profileId, feedType, timestamp)
            .put("channelId", channelId)
            .put("payload", payload);
        write(context, result, profileId + "\n" + feedType + "\n" + channelId);
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
        String slot = profileId + "\n" + feedType + "\nfailure";
        String slotName = UUID.nameUUIDFromBytes(slot.getBytes(StandardCharsets.UTF_8)).toString();
        File failure = new File(directory(context), slotName + ".json");
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
        String slotName = UUID.nameUUIDFromBytes(slot.getBytes(StandardCharsets.UTF_8)).toString();
        File target = new File(directory, slotName + ".json");
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

    private static String createId() {
        return String.format("%013d-%s", System.currentTimeMillis(), UUID.randomUUID());
    }

    private static JSONObject read(File file) throws IOException, JSONException {
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
        return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
    }

    private static File directory(Context context) {
        File directory = new File(context.getFilesDir(), DIRECTORY_NAME);
        if (!directory.exists()) directory.mkdirs();
        return directory;
    }
}
