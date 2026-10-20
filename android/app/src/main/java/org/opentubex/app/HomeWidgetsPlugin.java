package org.opentubex.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "HomeWidgets")
public class HomeWidgetsPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void setContinueWatching(PluginCall call) {
        executor.execute(() -> {
            try {
                HomeWidgets.setContinueWatching(getContext(), HomeWidgets.parse(call.getArray("videos")),
                    HomeWidgets.Authorization.fromJson(call.getObject("authorization")));
                call.resolve();
            } catch (Exception error) {
                call.reject("Unable to update home screen widgets", error);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdown();
    }
}
