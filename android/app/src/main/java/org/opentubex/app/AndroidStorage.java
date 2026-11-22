package org.opentubex.app;

import java.io.File;

final class AndroidStorage {
    static final class Usage {
        final long appDataBytes;
        final long cacheBytes;

        Usage(long appDataBytes, long cacheBytes) {
            this.appDataBytes = appDataBytes;
            this.cacheBytes = cacheBytes;
        }

        long totalBytes() {
            return appDataBytes + cacheBytes;
        }
    }

    private AndroidStorage() {}

    static Usage measure(File dataDirectory, File... cacheDirectories) {
        long cacheBytes = 0;
        for (File directory : cacheDirectories) {
            cacheBytes += size(directory);
        }

        long totalBytes = size(dataDirectory);
        return new Usage(Math.max(totalBytes - cacheBytes, 0), cacheBytes);
    }

    static long size(File entry) {
        if (entry == null || !entry.exists()) return 0;
        if (entry.isFile()) return entry.length();

        File[] children = entry.listFiles();
        if (children == null) return 0;

        long bytes = 0;
        for (File child : children) bytes += size(child);
        return bytes;
    }

    static boolean clearDirectory(File directory) {
        if (directory == null || !directory.exists()) return true;

        File[] children = directory.listFiles();
        if (children == null) return false;

        boolean cleared = true;
        for (File child : children) cleared &= delete(child);
        return cleared;
    }

    private static boolean delete(File entry) {
        boolean deletedChildren = true;
        if (entry.isDirectory()) {
            File[] children = entry.listFiles();
            if (children == null) return false;
            for (File child : children) deletedChildren &= delete(child);
        }
        return deletedChildren && entry.delete();
    }
}
