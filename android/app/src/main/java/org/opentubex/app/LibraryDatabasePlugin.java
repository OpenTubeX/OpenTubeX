package org.opentubex.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native SQLite for the library datastores, which keeps them out of WebView storage. */
@CapacitorPlugin(name = "LibraryDatabase")
public class LibraryDatabasePlugin extends Plugin {
    // One thread runs every statement in order and keeps long imports off the
    // thread that serves other plugins.
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<String, LibraryDatabase> databases = new HashMap<>();

    private LibraryDatabase database(String name) {
        LibraryDatabase database = databases.get(name);
        if (database == null) {
            database = new LibraryDatabase(LibraryDatabase.directory(getContext()), name);
            databases.put(name, database);
        }
        return database;
    }

    @PluginMethod
    public void execute(PluginCall call) {
        String name = call.getString("name");
        JSArray statements = call.getArray("statements");
        boolean transaction = Boolean.TRUE.equals(call.getBoolean("transaction", false));
        executor.execute(() -> {
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

    @PluginMethod
    public void drop(PluginCall call) {
        String name = call.getString("name");
        executor.execute(() -> {
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
        executor.execute(() -> {
            for (LibraryDatabase database : databases.values()) database.close();
            databases.clear();
        });
        executor.shutdown();
    }
}
