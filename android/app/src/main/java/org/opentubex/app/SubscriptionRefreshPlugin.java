package org.opentubex.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.UUID;

import androidx.core.content.ContextCompat;

@CapacitorPlugin(name = "SubscriptionRefresh")
public class SubscriptionRefreshPlugin extends Plugin {
    private BroadcastReceiver cancellationReceiver;

    @Override
    public void load() {
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
    }

    @Override
    protected void handleOnDestroy() {
        if (cancellationReceiver != null) {
            getContext().unregisterReceiver(cancellationReceiver);
            cancellationReceiver = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void start(PluginCall call) {
        String title = call.getString("title");
        if (title == null || title.trim().isEmpty()) {
            call.reject("A notification title is required");
            return;
        }

        String token = UUID.randomUUID().toString();
        String cancelLabel = call.getString("cancelLabel", "Cancel");
        boolean acquired = SubscriptionRefreshWorker.start(getContext(), token, title, cancelLabel);
        JSObject result = new JSObject();
        result.put("token", token);
        result.put("acquired", acquired);
        call.resolve(result);
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
    public void isActive(PluginCall call) {
        JSObject response = new JSObject();
        response.put("active", SubscriptionRefreshCoordinator.isActive());
        call.resolve(response);
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
    public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
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
    public void finish(PluginCall call) {
        String token = call.getString("token");
        if (token == null) {
            call.reject("A token is required");
            return;
        }
        SubscriptionRefreshWorker.finish(getContext(), token);
        call.resolve();
    }
}
