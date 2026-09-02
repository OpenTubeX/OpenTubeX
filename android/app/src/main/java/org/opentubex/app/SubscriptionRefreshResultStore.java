package org.opentubex.app;

import android.content.Context;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;

final class SubscriptionRefreshResultStore {
    private static final String DIRECTORY_NAME = "subscription-refresh-results";

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

    static synchronized JSONObject readNext(Context context) throws IOException, JSONException {
        File[] files = directory(context).listFiles((dir, name) -> name.endsWith(".json"));
        if (files == null || files.length == 0) return null;
        Arrays.sort(files, (first, second) -> first.getName().compareTo(second.getName()));
        File file = files[0];
        return read(file);
    }

    static synchronized boolean acknowledge(Context context, String id) throws IOException, JSONException {
        if (id == null) return false;
        File[] files = directory(context).listFiles((dir, name) -> name.endsWith(".json"));
        if (files == null) return false;
        for (File file : files) {
            if (id.equals(read(file).optString("id"))) return file.delete();
        }
        // A newer result may have replaced the slot after the renderer read it.
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
        String id = result.getString("id");
        String slotName = UUID.nameUUIDFromBytes(slot.getBytes(StandardCharsets.UTF_8)).toString();
        File target = new File(directory(context), slotName + ".json");
        File temporary = new File(directory(context), id + ".tmp");
        byte[] bytes = result.toString().getBytes(StandardCharsets.UTF_8);
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write(bytes);
            output.getFD().sync();
        }
        if (!temporary.renameTo(target)) {
            if (!target.delete() || !temporary.renameTo(target)) {
                temporary.delete();
                throw new IOException("Unable to commit pending refresh result");
            }
        }
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
