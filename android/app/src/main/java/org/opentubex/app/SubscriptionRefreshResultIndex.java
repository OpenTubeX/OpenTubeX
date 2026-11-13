package org.opentubex.app;

import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeMap;

/** Keeps response bodies on disk; only record IDs and slot paths stay in memory. */
final class SubscriptionRefreshResultIndex {
    interface IdReader {
        String read(File file) throws IOException;
    }

    private final TreeMap<String, File> filesById = new TreeMap<>();
    private final Map<File, String> idsByFile = new HashMap<>();

    SubscriptionRefreshResultIndex(File directory, IdReader readId) throws IOException {
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".json"));
        if (files != null) {
            for (File file : files) put(file, readId.read(file));
        }
    }

    void put(File file, String id) {
        remove(file);
        filesById.put(id, file);
        idsByFile.put(file, id);
    }

    void remove(File file) {
        String id = idsByFile.remove(file);
        if (id != null) filesById.remove(id);
    }

    File first() {
        return filesById.isEmpty() ? null : filesById.firstEntry().getValue();
    }

    File get(String id) {
        return filesById.get(id);
    }
}
