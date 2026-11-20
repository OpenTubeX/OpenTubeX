package org.opentubex.app;

import android.util.Log;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * yt-dlp rewrites its {@code --cookies} file when it exits. Processes that shared one
 * could read another's partial write, and the last to exit would discard the cookies
 * YouTube rotated for the others. Each process gets a private copy instead, which
 * {@link Checkout#release} merges back once it exits, like src/main/ytDlpCookieFile.js.
 */
final class YtDlpCookies {
    private static final String HEADER = "# Netscape HTTP Cookie File";
    private static final Object LOCK = new Object();

    private YtDlpCookies() {}

    static final class Checkout {
        final List<String> args;
        private final File shared;
        private final File copy;
        private final String base;

        private Checkout(List<String> args, File shared, File copy, String base) {
            this.args = args;
            this.shared = shared;
            this.copy = copy;
            this.base = base;
        }

        /** @param finished whether the process exited on its own, so that it finished saving */
        void release(boolean finished) {
            if (copy == null) return;
            synchronized (LOCK) {
                try {
                    String merged = merge(base, read(copy), read(shared), finished);
                    if (merged != null) YtDlpFiles.write(shared, merged.getBytes(StandardCharsets.UTF_8));
                } catch (IOException error) {
                    Log.w("YtDlpCookies", "Could not save the cookies yt-dlp updated");
                } finally {
                    copy.delete();
                }
            }
        }
    }

    static Checkout checkOut(File temporaryDirectory, List<String> args) {
        int index = args.lastIndexOf("--cookies");
        if (index == -1 || index + 1 >= args.size()) return new Checkout(args, null, null, null);
        File shared = new File(args.get(index + 1));
        synchronized (LOCK) {
            String base;
            // yt-dlp reports the missing file.
            try { base = read(shared); } catch (IOException error) { return new Checkout(args, null, null, null); }
            File copy = null;
            try {
                copy = File.createTempFile("yt-dlp-cookies-", ".txt", temporaryDirectory);
                YtDlpFiles.write(copy, base.getBytes(StandardCharsets.UTF_8));
            } catch (IOException error) {
                // Without room for a copy, share the file as before instead of failing the process.
                Log.w("YtDlpCookies", "Could not copy the yt-dlp cookie file");
                if (copy != null) copy.delete();
                return new Checkout(args, null, null, null);
            }
            List<String> copied = new ArrayList<>(args);
            copied.set(index + 1, copy.getAbsolutePath());
            return new Checkout(copied, shared, copy, base);
        }
    }

    private static String read(File file) throws IOException {
        return new String(YtDlpFiles.readFile(file), StandardCharsets.UTF_8);
    }

    private static final class Cookie {
        final String line;
        final String state;
        Cookie(String line, String state) { this.line = line; this.state = state; }
    }

    /** Reads the cookies of a Netscape cookie file, keyed like yt-dlp's cookie jar. */
    private static Map<String, Cookie> parse(String text) {
        Map<String, Cookie> cookies = new LinkedHashMap<>();
        for (String line : text.split("\r?\n")) {
            if (line.startsWith("#") && !line.startsWith("#HttpOnly_")) continue;
            String[] fields = line.replaceFirst("^#HttpOnly_", "").split("\t", -1);
            if (fields.length != 7) continue;
            long expires;
            try { expires = (long) Double.parseDouble(fields[4]); } catch (NumberFormatException error) { expires = 0; }
            // yt-dlp drops the HttpOnly prefix and stores session cookies as expiring at
            // 0 when it saves, so only compare what it keeps.
            cookies.put(fields[0] + "\t" + fields[2] + "\t" + fields[5], new Cookie(line, fields[3] + "\t" + expires + "\t" + fields[6]));
        }
        return cookies;
    }

    /**
     * Applies the cookies one yt-dlp process changed to the current file, keeping those
     * other processes changed in the meantime, or returns null when nothing changed.
     * Only a process that {@code finished} saving removes the cookies missing from its file.
     */
    static String merge(String base, String result, String current, boolean finished) {
        // yt-dlp writes the header first and ends every cookie with a newline. A process
        // stopped while saving can still leave complete rows, so it removes no cookies.
        if (!result.startsWith(HEADER) || !result.endsWith("\n")) return null;
        Map<String, Cookie> before = parse(base);
        Map<String, Cookie> after = parse(result);
        Map<String, Cookie> merged = parse(current);
        boolean changed = false;
        for (Map.Entry<String, Cookie> entry : after.entrySet()) {
            String state = entry.getValue().state;
            if (state.equals(state(before, entry.getKey())) || state.equals(state(merged, entry.getKey()))) continue;
            merged.put(entry.getKey(), entry.getValue());
            changed = true;
        }
        for (Map.Entry<String, Cookie> entry : before.entrySet()) {
            if (!finished || after.containsKey(entry.getKey()) || !entry.getValue().state.equals(state(merged, entry.getKey()))) continue;
            merged.remove(entry.getKey());
            changed = true;
        }
        if (!changed) return null;
        StringBuilder text = new StringBuilder(HEADER).append('\n');
        for (Cookie cookie : merged.values()) text.append(cookie.line).append('\n');
        return text.toString();
    }

    private static String state(Map<String, Cookie> cookies, String key) {
        Cookie cookie = cookies.get(key);
        return cookie == null ? null : cookie.state;
    }
}
