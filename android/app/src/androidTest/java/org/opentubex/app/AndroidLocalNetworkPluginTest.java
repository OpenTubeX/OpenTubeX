package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assume.assumeTrue;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.Test;

public class AndroidLocalNetworkPluginTest {
    @Test public void preflightRunsOffThreadAndRecognizesLocalHosts() throws Exception {
        assumeTrue(Build.VERSION.SDK_INT >= 37);
        assumeTrue(ContextCompat.checkSelfPermission(InstrumentationRegistry.getInstrumentation().getTargetContext(),
            Manifest.permission.ACCESS_LOCAL_NETWORK) != PackageManager.PERMISSION_GRANTED);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            for (String hostname : new String[]{"127.0.0.1", "NAS.LOCAL", "100.64.0.1"}) {
                CompletableFuture<JSObject> result = new CompletableFuture<>();
                scenario.onActivity(activity -> {
                    Thread caller = Thread.currentThread();
                    AndroidLocalNetworkPlugin plugin = (AndroidLocalNetworkPlugin)
                        activity.getBridge().getPlugin("AndroidLocalNetwork").getInstance();
                    plugin.checkAccess(new PluginCall(null, "AndroidLocalNetwork", "test", "checkAccess",
                        new JSObject().put("hostname", hostname).put("direct", true)) {
                        @Override public void resolve(JSObject value) {
                            if (Thread.currentThread() == caller) {
                                result.completeExceptionally(new AssertionError("DNS preflight ran on the calling thread"));
                            } else result.complete(value);
                        }
                        @Override public void reject(String message) { result.completeExceptionally(new AssertionError(message)); }
                    });
                });
                assertEquals(hostname, !hostname.equals("127.0.0.1"), result.get(10, TimeUnit.SECONDS).getBoolean("required", false));
            }
        }
    }
}
