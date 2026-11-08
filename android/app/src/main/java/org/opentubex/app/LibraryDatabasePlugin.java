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
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Native SQLite for the library datastores, which keeps them out of WebView storage. */
@CapacitorPlugin(name = "LibraryDatabase")
public class LibraryDatabasePlugin extends Plugin {
    // Each database runs its statements in order on its own thread, off the
    // thread that serves other plugins. Separate databases share no
    // transactions, so startup can read history and playlists concurrently.
    private final Map<String, ExecutorService> executors = new ConcurrentHashMap<>();
    private final Map<String, LibraryDatabase> databases = new ConcurrentHashMap<>();

    private volatile boolean destroyed;

    /** Calls can still arrive from the WebView after its activity destroyed this plugin. */
    private void run(PluginCall call, String name, Runnable task) {
        try {
            if (destroyed) throw new RejectedExecutionException("Library database closed");
            executor(name).execute(task);
        } catch (RejectedExecutionException error) {
            call.reject("Library database closed", error);
        }
    }

    private ExecutorService executor(String name) {
        return executors.computeIfAbsent(name, key -> {
            // Keep the per-database order, but let an idle database's thread exit.
            ThreadPoolExecutor executor = new ThreadPoolExecutor(1, 1, 30, TimeUnit.SECONDS, new LinkedBlockingQueue<>());
            executor.allowCoreThreadTimeOut(true);
            return executor;
        });
    }

    // Large reads, such as loading all history at startup, cost seconds as one
    // bridge message. They are written here and fetched through the local server.
    private File results() {
        return new File(getContext().getCacheDir(), "library-results");
    }

    @Override
    public void load() {
        File[] stale = results().listFiles();
        if (stale != null) for (File file : stale) file.delete();
    }

    private LibraryDatabase database(String name) {
        return databases.computeIfAbsent(name, key -> new LibraryDatabase(LibraryDatabase.directory(getContext()), key));
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
            File file = null;
            try {
                if (sql == null) throw new IllegalArgumentException("Missing statement");
                File directory = results();
                if (!directory.isDirectory() && !directory.mkdirs()) {
                    throw new IllegalStateException("Unable to create the library results directory");
                }
                file = new File(directory, UUID.randomUUID() + ".json");
                try (Writer output = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(file), StandardCharsets.UTF_8))) {
                    database(name).query(sql, params, output);
                }
                JSObject result = new JSObject();
                result.put("path", file.getAbsolutePath());
                call.resolve(result);
            } catch (Exception error) {
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
    protected void handleOnDestroy() {
        destroyed = true;
        for (Map.Entry<String, ExecutorService> entry : executors.entrySet()) {
            entry.getValue().execute(() -> {
                LibraryDatabase database = databases.remove(entry.getKey());
                if (database != null) database.close();
            });
            entry.getValue().shutdown();
        }
    }
}
