package org.opentubex.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.plugin.util.CapacitorHttpUrlConnection;
import com.getcapacitor.plugin.util.HttpRequestHandler;

import org.json.JSONException;

import java.io.InterruptedIOException;
import java.util.Map;
import java.util.concurrent.CancellationException;
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

    private final Map<String, RequestOptions> activeRequests = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newCachedThreadPool();

    @PluginMethod
    public void request(PluginCall call) {
        String requestId = call.getString("requestId");
        RequestOptions options;
        try {
            options = new RequestOptions(call.getData());
        } catch (JSONException error) {
            call.reject(error.getLocalizedMessage(), error.getClass().getSimpleName(), error);
            return;
        }
        if (requestId == null || activeRequests.putIfAbsent(requestId, options) != null) {
            call.reject("Invalid request ID");
            return;
        }
        // HttpRequestHandler attaches its connection to the call's options,
        // so options that can be aborted see it as soon as it exists.
        PluginCall request = new PluginCall(null, null, PluginCall.CALLBACK_ID_DANGLING, null, options);
        try {
            executor.execute(() -> {
                try {
                    // Aborted before a thread became available.
                    if (options.isAborted()) throw new InterruptedIOException("Request aborted");
                    call.resolve(HttpRequestHandler.request(request, null, getBridge()));
                } catch (Exception error) {
                    call.reject(error.getLocalizedMessage(), error.getClass().getSimpleName(), error);
                } finally {
                    activeRequests.remove(requestId, options);
                }
            });
        } catch (RejectedExecutionException error) {
            activeRequests.remove(requestId, options);
            call.reject("Failed to execute request - Http Plugin was shutdown");
        }
    }

    @PluginMethod
    public void abort(PluginCall call) {
        String requestId = call.getString("requestId");
        // The request stays tracked until its worker finishes, because an
        // abort can arrive before the connection is open.
        RequestOptions request = requestId == null ? null : activeRequests.get(requestId);
        if (request != null) request.abort();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        for (RequestOptions request : activeRequests.values()) request.abort();
        activeRequests.clear();
        super.handleOnDestroy();
    }

    /**
     * Request options that close the connection HttpRequestHandler attaches
     * to them once aborted, and fail requests aborted before the attachment.
     */
    static final class RequestOptions extends JSObject {
        private boolean aborted;
        private Runnable disconnect;

        RequestOptions(JSObject options) throws JSONException {
            super(options.toString());
        }

        @Override
        public JSObject put(String key, Object value) {
            // Disconnecting from another thread fails the blocked connect or read.
            if (ACTIVE_CONNECTION.equals(key) && value instanceof CapacitorHttpUrlConnection) {
                attach(((CapacitorHttpUrlConnection) value)::disconnect);
            }
            return super.put(key, value);
        }

        synchronized void attach(Runnable disconnect) {
            // Disconnecting before the connection opens does nothing, so fail
            // the request before HttpRequestHandler connects it.
            if (aborted) throw new CancellationException("Request aborted");
            this.disconnect = disconnect;
        }

        synchronized void abort() {
            aborted = true;
            if (disconnect != null) disconnect.run();
        }

        synchronized boolean isAborted() {
            return aborted;
        }
    }
}
