package org.opentubex.app;

import com.getcapacitor.PluginCall;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;

/** Runs plugin calls on a plugin's own executor. */
final class PluginWork {
    private PluginWork() {}

    /**
     * Capacitor can still deliver a call that the renderer sent while the
     * activity was being destroyed, after the plugin shut its executor down.
     * Rejecting the call keeps the rejection from crashing the app.
     */
    static void execute(ExecutorService executor, PluginCall call, Runnable work) {
        try {
            executor.execute(work);
        } catch (RejectedExecutionException error) {
            call.reject("The app is closing");
        }
    }
}
