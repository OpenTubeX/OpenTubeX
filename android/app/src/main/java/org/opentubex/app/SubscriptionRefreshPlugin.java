package org.opentubex.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

import androidx.core.content.ContextCompat;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "SubscriptionRefresh")
public class SubscriptionRefreshPlugin extends Plugin {
    // Original title lookups use the network, so they must not block other plugin calls.
    private static final ExecutorService UPLOADS = Executors.newSingleThreadExecutor();
    private BroadcastReceiver cancellationReceiver;
    private BroadcastReceiver notificationsQueuedReceiver;
    private Consumer<Boolean> rendererActiveListener;
    private volatile String rendererToken;
    private boolean destroyed;
    private boolean batchActive;
    private boolean waitingForNextFeed;
    private volatile boolean rendererRetained;
    private SubscriptionRefreshDisplay retainedDisplay;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable releaseRenderer = () -> {
        if (!markRendererForDisposal()) return;
        bridge.onDestroy();
        bridge.onDetachedFromWindow();
    };

    private synchronized boolean markRendererForDisposal() {
        if (!rendererRetained || SubscriptionRefreshWorker.isRendererActive(rendererToken)) return false;
        // Close startup atomically before invoking other plugins' teardown.
        destroyed = true;
        rendererRetained = false;
        return true;
    }

    // The background service keeps the process alive. Retain its JS executor too,
    // since Capacitor normally destroys it with the recents task.
    synchronized boolean retainRenderer() {
        if (!SubscriptionRefreshWorker.isRendererActive(rendererToken)) return false;
        if (retainedDisplay == null) {
            try {
                retainedDisplay = new SubscriptionRefreshDisplay(bridge.getWebView());
            } catch (RuntimeException error) {
                android.util.Log.e("OpenTubeXFetch", "Unable to retain subscription refresh display", error);
                return false;
            }
        }
        rendererRetained = true;
        return true;
    }

    boolean isRendererRetained() {
        return rendererRetained;
    }

    @Override
    public void load() {
        rendererActiveListener = active -> bridge.executeOnMainThread(() -> {
            if (bridge.getWebView() instanceof SubscriptionRefreshWebView webView) {
                webView.setRefreshActive(active);
            }
            if (rendererRetained) {
                mainHandler.removeCallbacks(releaseRenderer);
                if (!SubscriptionRefreshWorker.isRendererActive(rendererToken)) {
                    mainHandler.post(releaseRenderer);
                }
            }
        });
        SubscriptionRefreshWorker.observeRendererActive(rendererActiveListener);
        cancellationReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                notifyListeners("cancelled", new JSObject());
            }
        };
        ContextCompat.registerReceiver(
            getContext(),
            cancellationReceiver,
            new IntentFilter(SubscriptionRefreshCancelReceiver.ACTION_CANCELLED),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
        notificationsQueuedReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                notifyListeners("notificationsQueued", new JSObject());
            }
        };
        ContextCompat.registerReceiver(
            getContext(),
            notificationsQueuedReceiver,
            new IntentFilter(UploadNotifications.ACTION_QUEUED),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
    }

    @Override
    protected synchronized void handleOnDestroy() {
        destroyed = true;
        if (retainedDisplay != null) {
            retainedDisplay.close();
            retainedDisplay = null;
        }
        mainHandler.removeCallbacks(releaseRenderer);
        SubscriptionRefreshWorker.removeRendererActiveListener(rendererActiveListener);
        // The renderer cannot finish its refresh once its WebView is destroyed.
        // Only release work acquired by this plugin, leaving scheduled work alone.
        if (rendererToken != null) {
            // Behind pending upload checks, like a finished refresh.
            Context context = getContext();
            String token = rendererToken;
            UPLOADS.execute(() -> SubscriptionRefreshWorker.finish(context, token));
            rendererToken = null;
        }
        if (cancellationReceiver != null) {
            getContext().unregisterReceiver(cancellationReceiver);
            cancellationReceiver = null;
        }
        if (notificationsQueuedReceiver != null) {
            getContext().unregisterReceiver(notificationsQueuedReceiver);
            notificationsQueuedReceiver = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public synchronized void start(PluginCall call) {
        if (destroyed) {
            call.reject("The subscription refresh renderer was destroyed");
            return;
        }
        String title = call.getString("title");
        if (title == null || title.trim().isEmpty()) {
            call.reject("A notification title is required");
            return;
        }

        String token = batchActive && waitingForNextFeed ? rendererToken : UUID.randomUUID().toString();
        String cancelLabel = call.getString("cancelLabel", "Cancel");
        boolean acquired = batchActive && waitingForNextFeed
            ? SubscriptionRefreshWorker.startNextFeed(getContext(), token, title, cancelLabel)
            : SubscriptionRefreshWorker.start(getContext(), token, title, cancelLabel);
        if (acquired) waitingForNextFeed = false;
        if (acquired) rendererToken = token;
        if (acquired) SubscriptionRefreshCoordinator.update(token, call.getString("tab"), 0);
        JSObject result = new JSObject();
        result.put("token", token);
        result.put("acquired", acquired);
        call.resolve(result);
    }

    @PluginMethod
    public synchronized void beginBatch(PluginCall call) {
        if (destroyed) {
            call.reject("The subscription refresh renderer was destroyed");
            return;
        }
        String token = UUID.randomUUID().toString();
        boolean acquired = !batchActive && SubscriptionRefreshWorker.start(
            getContext(), token, call.getString("title", "Refreshing subscriptions"),
            call.getString("cancelLabel", "Cancel")
        );
        if (acquired) {
            rendererToken = token;
            batchActive = true;
            waitingForNextFeed = true;
        }
        JSObject result = new JSObject();
        result.put("acquired", acquired);
        call.resolve(result);
    }

    @PluginMethod
    public synchronized void endBatch(PluginCall call) {
        batchActive = false;
        if (waitingForNextFeed) {
            waitingForNextFeed = false;
            finishAfterUploadChecks(call, rendererToken);
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void configure(PluginCall call) {
        JSObject configuration = call.getObject("configuration");
        if (configuration == null) {
            call.reject("A refresh configuration is required");
            return;
        }
        SubscriptionRefreshConfiguration.save(getContext(), configuration);
        SubscriptionRefreshScheduler.reconcile(getContext());
        call.resolve();
    }

    @PluginMethod
    public void configureUploadNotifications(PluginCall call) {
        JSObject configuration = call.getObject("configuration");
        if (configuration == null) {
            call.reject("A notification configuration is required");
            return;
        }
        UploadNotifications.configure(getContext(), configuration);
        call.resolve();
    }

    @PluginMethod
    public void takeShownNotifications(PluginCall call) {
        try {
            call.resolve(JSObject.fromJSONObject(UploadNotifications.takeShown(getContext())));
        } catch (Exception error) {
            call.reject("Unable to read shown notifications", error);
        }
    }

    @PluginMethod
    public void cancelUploadNotifications(PluginCall call) {
        JSArray uploads = call.getArray("uploads");
        if (uploads == null) {
            call.reject("Uploads are required");
            return;
        }
        for (int i = 0; i < uploads.length(); i++) {
            JSONObject upload = uploads.optJSONObject(i);
            String feedType = upload == null ? null : upload.optString("feedType", null);
            String id = upload == null ? null : upload.optString("id", null);
            if (feedType != null && id != null) UploadNotifications.cancel(getContext(), feedType, id);
        }
        call.resolve();
    }

    @PluginMethod
    public void observeUploads(PluginCall call) {
        String channelId = call.getString("channelId");
        String feedType = call.getString("feedType");
        JSArray entries = call.getArray("entries");
        if (channelId == null || feedType == null || entries == null) {
            call.reject("A channel feed is required");
            return;
        }
        Context context = getContext();
        UPLOADS.execute(() -> {
            try {
                UploadNotifications.observe(context, channelId, feedType, entries);
                call.resolve();
            } catch (Exception error) {
                call.reject("Unable to check for new uploads", error);
            }
        });
    }

    @PluginMethod
    public synchronized void isActive(PluginCall call) {
        JSObject response = new JSObject();
        // Only this batch's renderer may start its next feed. Reopened activities
        // and scheduled workers continue to see the background refresh as busy.
        boolean ownsIdleBatch = batchActive && waitingForNextFeed &&
            SubscriptionRefreshWorker.isRendererActive(rendererToken);
        response.put("active", SubscriptionRefreshCoordinator.isActive() && !ownsIdleBatch);
        call.resolve(response);
    }

    @PluginMethod
    public synchronized void getState(PluginCall call) {
        SubscriptionRefreshCoordinator.Snapshot state = SubscriptionRefreshCoordinator.snapshot();
        JSObject response = new JSObject();
        response.put("inProgress", state.token() != null);
        response.put("percentage", state.percentage());
        response.put("tab", state.tab());
        response.put("ownedByRenderer", state.token() != null && state.token().equals(rendererToken));
        response.put("rendererActive", SubscriptionRefreshWorker.isRendererActive(state.token()));
        call.resolve(response);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        SubscriptionRefreshCoordinator.Snapshot state = SubscriptionRefreshCoordinator.snapshot();
        if (state.token() != null && !SubscriptionRefreshCoordinator.isCancelled(state.token())) {
            new SubscriptionRefreshCancelReceiver().onReceive(getContext(),
                new Intent(SubscriptionRefreshCancelReceiver.ACTION_CANCEL)
                    .putExtra(SubscriptionRefreshCancelReceiver.TOKEN_EXTRA, state.token()));
        }
        call.resolve();
    }

    @PluginMethod
    public void nextPendingResult(PluginCall call) {
        try {
            JSObject response = new JSObject();
            response.put("result", SubscriptionRefreshResultStore.readNext(getContext()));
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Unable to read pending subscription refresh data", error);
        }
    }

    @PluginMethod
    public void forgetFingerprints(PluginCall call) {
        Set<String> channelIds = null;
        JSArray ids = call.getArray("channelIds");
        try {
            if (ids != null) channelIds = new HashSet<>(ids.<String>toList());
        } catch (JSONException error) {
            call.reject("Channel IDs must be strings", error);
            return;
        }
        if (SubscriptionRefreshResultStore.forgetFingerprints(getContext(), channelIds)) call.resolve();
        else call.reject("Unable to reset pending subscription refresh fingerprints");
    }

    @PluginMethod
    public void acknowledgePendingResult(PluginCall call) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("A result ID is required");
            return;
        }
        try {
            JSObject response = new JSObject();
            response.put("removed", SubscriptionRefreshResultStore.acknowledge(getContext(), id));
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Unable to acknowledge pending subscription refresh data", error);
        }
    }

    @PluginMethod
    public synchronized void update(PluginCall call) {
        String token = call.getString("token");
        Integer progress = call.getInt("progress");
        if (token == null || progress == null) {
            call.reject("A token and progress are required");
            return;
        }
        JSObject result = new JSObject();
        result.put("updated", SubscriptionRefreshWorker.update(getContext(), token, progress));
        call.resolve(result);
    }

    @PluginMethod
    public synchronized void finish(PluginCall call) {
        String token = call.getString("token");
        if (token == null) {
            call.reject("A token is required");
            return;
        }
        if (batchActive && token.equals(rendererToken) && SubscriptionRefreshWorker.isRendererActive(token)) {
            waitingForNextFeed = true;
            call.resolve();
        } else {
            finishAfterUploadChecks(call, token);
        }
    }

    /**
     * Upload checks run after the refresh reports its feeds. Queue the release of the
     * foreground service behind them, so their notifications are shown before the process
     * can be stopped, without blocking other plugin calls or the main thread meanwhile.
     */
    private void finishAfterUploadChecks(PluginCall call, String token) {
        Context context = getContext();
        UPLOADS.execute(() -> {
            try {
                SubscriptionRefreshWorker.finish(context, token);
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("Unable to finish the subscription refresh", error);
            }
        });
    }
}
