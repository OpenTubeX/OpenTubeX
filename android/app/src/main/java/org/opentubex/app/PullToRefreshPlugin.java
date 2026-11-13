package org.opentubex.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Local Capacitor plugin, licensed under the repository's AGPL-3.0-or-later license. */
@CapacitorPlugin(name = "PullToRefresh")
public class PullToRefreshPlugin extends Plugin {
    private PullToRefreshLayout layout;
    private final Runnable finishTimeout = () -> {
        if (layout != null) layout.setRefreshing(false);
    };

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            layout = (PullToRefreshLayout) getBridge().getWebView().getParent();
            layout.setOnRefreshListener(() -> {
                JSObject context = layout.getRefreshContext();
                if (context == null) {
                    layout.setRefreshing(false);
                    return;
                }
                // A renderer crash must not leave a permanent native spinner.
                layout.removeCallbacks(finishTimeout);
                layout.postDelayed(finishTimeout, 60000);
                notifyListeners("refresh", context);
            });
        });
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            layout.configure(getBridge().getWebView(), call.getBoolean("enabled", false));
            call.resolve();
        });
    }

    @PluginMethod
    public void finish(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            layout.removeCallbacks(finishTimeout);
            layout.setRefreshing(false);
            call.resolve();
        });
    }

    @Override
    protected void handleOnPause() {
        if (layout != null) {
            layout.removeCallbacks(finishTimeout);
            layout.setRefreshing(false);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (layout != null) {
            layout.removeCallbacks(finishTimeout);
            layout.configure(getBridge().getWebView(), false);
            layout.setOnRefreshListener(null);
        }
    }
}
