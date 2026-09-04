package org.opentubex.app;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;

/** Resume a stopped periodic refresh without refetching its completed channels. */
final class SubscriptionRefreshCheckpoint {
    private final File file;
    private final String configuration;
    int nextIndex;
    int completed;
    int failed;
    final Set<String> failedProfileIds = new LinkedHashSet<>();

    private SubscriptionRefreshCheckpoint(File file, String configuration) {
        this.file = file;
        this.configuration = configuration;
    }

    static String configurationId(List<SubscriptionRefreshConfiguration.Feed> feeds) {
        StringBuilder value = new StringBuilder();
        for (SubscriptionRefreshConfiguration.Feed feed : feeds) {
            for (String field : new String[] { feed.profileId, feed.type, feed.instanceUrl, feed.authorization }) {
                if (field == null) value.append("-1:");
                else value.append(field.length()).append(':').append(field);
            }
            value.append(feed.channelIds.size()).append(':');
            for (String channelId : feed.channelIds) value.append(channelId.length()).append(':').append(channelId);
        }
        return UUID.nameUUIDFromBytes(value.toString().getBytes(StandardCharsets.UTF_8)).toString();
    }

    static SubscriptionRefreshCheckpoint load(File file, String configuration, int channelCount) throws IOException {
        SubscriptionRefreshCheckpoint checkpoint = new SubscriptionRefreshCheckpoint(file, configuration);
        if (!file.exists()) return checkpoint;
        Properties saved = new Properties();
        try (FileInputStream input = new FileInputStream(file)) {
            saved.load(input);
        } catch (IllegalArgumentException error) {
            // Malformed properties must not prevent every later retry from starting.
            return checkpoint;
        }
        if (!configuration.equals(saved.getProperty("configuration"))) return checkpoint;
        try {
            int nextIndex = Integer.parseInt(saved.getProperty("nextIndex"));
            int completed = Integer.parseInt(saved.getProperty("completed"));
            int failed = Integer.parseInt(saved.getProperty("failed"));
            if (nextIndex < 0 || nextIndex > channelCount || completed < 0 || failed < 0 || completed + failed != nextIndex) {
                return checkpoint;
            }
            checkpoint.nextIndex = nextIndex;
            checkpoint.completed = completed;
            checkpoint.failed = failed;
            for (String key : saved.stringPropertyNames()) {
                if (key.startsWith("failedProfile.")) checkpoint.failedProfileIds.add(key.substring("failedProfile.".length()));
            }
        } catch (NumberFormatException ignored) {
            // An incomplete checkpoint starts a fresh pass; cached results remain safe.
        }
        return checkpoint;
    }

    void save(int nextIndex, int completed, int failed, Set<String> failedProfileIds) throws IOException {
        Properties saved = new Properties();
        saved.setProperty("configuration", configuration);
        saved.setProperty("nextIndex", String.valueOf(nextIndex));
        saved.setProperty("completed", String.valueOf(completed));
        saved.setProperty("failed", String.valueOf(failed));
        for (String profileId : failedProfileIds) saved.setProperty("failedProfile." + profileId, "true");
        File temporary = new File(file.getPath() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            saved.store(output, null);
            output.getFD().sync();
        }
        if (!temporary.renameTo(file)) throw new IOException("Unable to save subscription refresh progress");
    }

    void clear() throws IOException {
        if (!file.delete() && file.exists()) throw new IOException("Unable to clear subscription refresh progress");
    }
}
