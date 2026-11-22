package org.opentubex.app;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Unpack installed Python code once so imports can reuse their compiled bytecode. */
final class YtDlpCodeCache {
    static synchronized void invalidate(File directory) throws IOException {
        Files.deleteIfExists(new File(directory, ".archive-version").toPath());
    }

    static synchronized File prepare(File archive, File directory) throws InterruptedIOException {
        File staging = new File(directory.getPath() + ".tmp");
        String version = archive.lastModified() + ":" + archive.length();
        File marker = new File(directory, ".archive-version");
        try {
            if (new File(directory, "__main__.py").isFile() && marker.isFile()
                && version.equals(new String(Files.readAllBytes(marker.toPath()), StandardCharsets.UTF_8))) return directory;

            deleteTree(staging);
            Files.createDirectories(staging.toPath());
            String prefix = staging.getCanonicalPath() + File.separator;
            // Android's ZipFile rejects executable ZIPs with a shebang. Read
            // their local entries after the bounded interpreter line instead.
            try (BufferedInputStream input = new BufferedInputStream(new FileInputStream(archive))) {
                input.mark(2);
                if (input.read() == '#' && input.read() == '!') {
                    int length = 2, value;
                    do {
                        value = input.read();
                        if (value < 0 || ++length > 8192) throw new IOException("Invalid yt-dlp shebang");
                    } while (value != '\n');
                } else { input.reset(); }
                try (ZipInputStream zip = new ZipInputStream(input)) {
                    byte[] buffer = new byte[32 * 1024];
                    ZipEntry entry;
                    while ((entry = zip.getNextEntry()) != null) {
                        if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
                        File file = new File(staging, entry.getName());
                        if (!file.getCanonicalPath().startsWith(prefix)) throw new IOException("Invalid yt-dlp archive path");
                        if (entry.isDirectory()) { Files.createDirectories(file.toPath()); continue; }
                        Files.createDirectories(file.getParentFile().toPath());
                        try (OutputStream output = new FileOutputStream(file)) {
                            int count;
                            while ((count = zip.read(buffer)) != -1) output.write(buffer, 0, count);
                        }
                    }
                }
            }
            if (!new File(staging, "__main__.py").isFile()) throw new IOException("Missing yt-dlp entry point");
            Files.write(new File(staging, marker.getName()).toPath(), version.getBytes(StandardCharsets.UTF_8));
            deleteTree(directory);
            Files.move(staging.toPath(), directory.toPath());
            return directory;
        } catch (InterruptedIOException error) {
            throw error;
        } catch (IOException error) {
            // Disk space or a damaged installation must not prevent archive execution.
            return archive;
        } finally {
            try { deleteTree(staging); } catch (IOException ignored) { /* Retry cleanup next time. */ }
        }
    }

    private static void deleteTree(File file) throws IOException {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        Files.deleteIfExists(file.toPath());
    }
}
