package org.opentubex.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.plugin.util.CapacitorHttpUrlConnection;
import com.getcapacitor.plugin.util.HttpRequestHandler;

import java.io.InterruptedIOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/**
 * Capacitor's HTTP plugin with cancellation. Superseded requests, such as
 * search suggestions for an earlier query, close their connection instead of
 * running until the server responds or the native timeout expires.
 */
@CapacitorPlugin(name = "AndroidHttp")
public class AndroidHttpPlugin extends Plugin {
    // Set by HttpRequestHandler while its connection is open.
    private static final String ACTIVE_CONNECTION = "activeCapacitorHttpUrlConnection";

    private final Map<String, PluginCall> activeRequests = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newCachedThreadPool();

    @PluginMethod
    public void request(PluginCall call) {
        String requestId = call.getString("requestId");
        if (requestId == null || activeRequests.putIfAbsent(requestId, call) != null) {
            call.reject("Invalid request ID");
            return;
        }
        try {
            executor.execute(() -> {
                try {
                    // Aborted before a thread became available.
                    if (activeRequests.get(requestId) != call) throw new InterruptedIOException("Request aborted");
                    call.resolve(HttpRequestHandler.request(call, null, getBridge()));
                } catch (Exception error) {
                    call.reject(error.getLocalizedMessage(), error.getClass().getSimpleName(), error);
                } finally {
                    activeRequests.remove(requestId, call);
                }
            });
        } catch (RejectedExecutionException error) {
            activeRequests.remove(requestId, call);
            call.reject("Failed to execute request - Http Plugin was shutdown");
        }
    }

    @PluginMethod
    public void abort(PluginCall call) {
        String requestId = call.getString("requestId");
        PluginCall request = requestId == null ? null : activeRequests.remove(requestId);
        if (request != null) disconnect(request);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        for (PluginCall request : activeRequests.values()) disconnect(request);
        activeRequests.clear();
        super.handleOnDestroy();
    }

    private static void disconnect(PluginCall request) {
        // Disconnecting from another thread fails the blocked connect or read.
        Object connection = request.getData().opt(ACTIVE_CONNECTION);
        if (connection instanceof CapacitorHttpUrlConnection) {
            ((CapacitorHttpUrlConnection) connection).disconnect();
        }
    }
}
