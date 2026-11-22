package org.opentubex.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Native SQLite for the library datastores, which keeps them out of WebView storage. */
@CapacitorPlugin(name = "LibraryDatabase")
public class LibraryDatabasePlugin extends Plugin {
    // Each database runs its statements in order on its own thread, off the
    // thread that serves other plugins. Separate databases share no
    // transactions, so startup can read history and playlists concurrently.
    // Every renderer in the process shares these threads, so the app's renderer
    // reads after the writes that the renderer syncing in the background queued.
    private static final Map<String, ExecutorService> EXECUTORS = new ConcurrentHashMap<>();
    private final Map<String, LibraryDatabase> databases = new ConcurrentHashMap<>();
    private final Set<String> used = new HashSet<>();

    private boolean destroyed;

    /** Calls can still arrive from the WebView after its activity destroyed this plugin. */
    private synchronized void run(PluginCall call, String name, Runnable task) {
        if (destroyed) {
            call.reject("Library database closed");
            return;
        }
        used.add(name);
        executor(name).execute(task);
    }

    private static ExecutorService executor(String name) {
        return EXECUTORS.computeIfAbsent(name, key -> {
            // Keep the per-database order, but let an idle database's thread exit.
            ThreadPoolExecutor executor = new ThreadPoolExecutor(1, 1, 30, TimeUnit.SECONDS, new LinkedBlockingQueue<>());
            executor.allowCoreThreadTimeOut(true);
            return executor;
        });
    }

    // Small reads return inline over the bridge to avoid temp-file I/O, a local
    // HTTP fetch, and a release call. Large reads spill to a file in cache.
    private static final int INLINE_RESULT_LIMIT = 64 * 1024;
    private static final String[] PREWARM_DATABASES = {
        "settings", "profiles", "playlists", "history",
        "watch-stats", "recommendations", "search-history",
        "tab-session", "live-reminders", "video-metadata-cache"
    };

    private File results() {
        return new File(getContext().getCacheDir(), "library-results");
    }

    @Override
    public void load() {
        File resultsDir = results();
        File[] stale = resultsDir.listFiles();
        File dbDir = LibraryDatabase.directory(getContext());
        if (stale != null && stale.length > 0) {
            executor("_cleanup").execute(() -> {
                for (File file : stale) file.delete();
            });
        }
        synchronized (this) {
            if (destroyed) return;
            for (String name : PREWARM_DATABASES) {
                if (!new File(dbDir, "library-" + name + ".sqlite").isFile()) continue;
                used.add(name);
                executor(name).execute(() -> {
                    try {
                        database(name).warm();
                    } catch (RuntimeException ignored) {
                        // Normal JS open will report any database error.
                    }
                });
            }
        }
    }

    private LibraryDatabase database(String name) {
        return databases.computeIfAbsent(name, key -> new LibraryDatabase(LibraryDatabase.directory(getContext()), key));
    }

    /** Buffers small JSON results in memory and spills larger ones to a cache file. */
    private static final class InlineOrFileWriter extends Writer {
        private final File directory;
        private StringBuilder buffer = new StringBuilder(1024);
        private File file;
        private Writer fileWriter;

        InlineOrFileWriter(File directory) {
            this.directory = directory;
        }

        private void spill() throws IOException {
            if (!directory.isDirectory() && !directory.mkdirs()) {
                throw new IllegalStateException("Unable to create the library results directory");
            }
            file = new File(directory, UUID.randomUUID() + ".json");
            fileWriter = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(file), StandardCharsets.UTF_8));
            fileWriter.write(buffer.toString());
            buffer = null;
        }

        @Override
        public void write(char[] chars, int offset, int length) throws IOException {
            if (fileWriter != null) {
                fileWriter.write(chars, offset, length);
                return;
            }
            if (buffer.length() + length > INLINE_RESULT_LIMIT) {
                spill();
                fileWriter.write(chars, offset, length);
            } else {
                buffer.append(chars, offset, length);
            }
        }

        @Override
        public void flush() throws IOException {
            if (fileWriter != null) fileWriter.flush();
        }

        @Override
        public void close() throws IOException {
            if (fileWriter != null) fileWriter.close();
        }

        File spilledFile() {
            return file;
        }

        String inlineText() {
            return buffer == null ? null : buffer.toString();
        }
    }

    @PluginMethod
    public void execute(PluginCall call) {
        String name = call.getString("name");
        if (name == null) {
            call.reject("Missing database name");
            return;
        }
        JSArray statements = call.getArray("statements");
        boolean transaction = Boolean.TRUE.equals(call.getBoolean("transaction", false));
        run(call, name, () -> {
            try {
                if (statements == null) throw new IllegalArgumentException("Missing statements");
                JSObject result = new JSObject();
                result.put("results", database(name).execute(statements, transaction));
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage(), error);
            }
        });
    }

    /** Writes one read-only statement's rows to a file and resolves its path. */
    @PluginMethod
    public void query(PluginCall call) {
        String name = call.getString("name");
        if (name == null) {
            call.reject("Missing database name");
            return;
        }
        String sql = call.getString("sql");
        JSArray params = call.getArray("params");
        run(call, name, () -> {
            InlineOrFileWriter output = new InlineOrFileWriter(results());
            try {
                if (sql == null) throw new IllegalArgumentException("Missing statement");
                try {
                    database(name).query(sql, params, output);
                } finally {
                    output.close();
                }
                JSObject result = new JSObject();
                File file = output.spilledFile();
                if (file != null) {
                    result.put("path", file.getAbsolutePath());
                } else {
                    result.put("rows", output.inlineText());
                }
                call.resolve(result);
            } catch (Exception error) {
                File file = output.spilledFile();
                if (file != null) file.delete();
                call.reject(error.getMessage(), error);
            }
        });
    }

    /** Deletes a result file once JavaScript has read it. */
    @PluginMethod
    public void release(PluginCall call) {
        String path = call.getString("path");
        try {
            // Only files directly inside the results directory can be deleted.
            // Canonical paths resolve "..", which a lexical parent check misses.
            File file = path == null ? null : new File(path).getCanonicalFile();
            if (file != null && results().getCanonicalFile().equals(file.getParentFile())) file.delete();
        } catch (IOException error) {
            // An unresolvable path is not a result file.
        }
        call.resolve();
    }

    @PluginMethod
    public void drop(PluginCall call) {
        String name = call.getString("name");
        if (name == null) {
            call.reject("Missing database name");
            return;
        }
        run(call, name, () -> {
            try {
                database(name).drop();
                databases.remove(name);
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage(), error);
            }
        });
    }

    @Override
    protected synchronized void handleOnDestroy() {
        destroyed = true;
        // Close after the statements already queued, without waiting on the main thread.
        for (String name : used) {
            executor(name).execute(() -> {
                LibraryDatabase database = databases.remove(name);
                if (database != null) database.close();
            });
        }
    }
}
