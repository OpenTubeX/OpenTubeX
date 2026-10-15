package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertFalse;
import static org.junit.Assume.assumeTrue;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.net.IpPrefix;
import java.net.InetAddress;
import androidx.core.content.ContextCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import org.junit.Test;

public class AndroidLocalNetworkPluginTest {
    @Test public void directlyConnectedIpv6PeersNeedAccessButDefaultAndGatewayRoutesDoNot() throws Exception {
        assumeTrue(Build.VERSION.SDK_INT >= 37);
        InetAddress peer = InetAddress.getByName("2001:db8:1234::2");
        IpPrefix prefix = new IpPrefix(InetAddress.getByName("2001:db8:1234::"), 64);
        assertTrue(AndroidLocalNetworkPlugin.isOnLinkIpv6(peer, prefix, false));
        assertFalse(AndroidLocalNetworkPlugin.isOnLinkIpv6(peer, prefix, true));
        assertFalse(AndroidLocalNetworkPlugin.isOnLinkIpv6(peer, new IpPrefix(InetAddress.getByName("::"), 0), false));
        assertFalse(AndroidLocalNetworkPlugin.isOnLinkIpv6(InetAddress.getByName("2001:db8:5678::2"), prefix, false));
        assertFalse(AndroidLocalNetworkPlugin.isOnLinkIpv6(InetAddress.getByName("::1"), new IpPrefix(InetAddress.getByName("::1"), 128), false));
    }

    @Test public void excessPreflightWorkRejectsInsteadOfAccumulating() throws Exception {
        assumeTrue(Build.VERSION.SDK_INT >= 37);
        assumeTrue(ContextCompat.checkSelfPermission(InstrumentationRegistry.getInstrumentation().getTargetContext(),
            Manifest.permission.ACCESS_LOCAL_NETWORK) != PackageManager.PERMISSION_GRANTED);
        CountDownLatch entered = new CountDownLatch(2);
        CountDownLatch release = new CountDownLatch(1);
        CompletableFuture<String> rejected = new CompletableFuture<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AndroidLocalNetworkPlugin[] plugin = new AndroidLocalNetworkPlugin[1];
            scenario.onActivity(activity -> plugin[0] = (AndroidLocalNetworkPlugin)
                activity.getBridge().getPlugin("AndroidLocalNetwork").getInstance());
            var field = AndroidLocalNetworkPlugin.class.getDeclaredField("worker");
            field.setAccessible(true);
            ExecutorService worker = (ExecutorService) field.get(plugin[0]);
            for (int index = 0; index < 2; index++) worker.execute(() -> {
                entered.countDown();
                try { release.await(); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            });
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            try {
                scenario.onActivity(activity -> {
                    for (int index = 0; index < 512; index++) {
                        plugin[0].checkAccess(new PluginCall(null, "AndroidLocalNetwork", Integer.toString(index), "checkAccess",
                            new JSObject().put("hostname", "127.0.0.1").put("direct", true)) {
                            @Override public void resolve(JSObject result) {}
                            @Override public void reject(String message) { rejected.complete(message); }
                        });
                    }
                });
                assertEquals("Too many pending local access checks", rejected.get(2, TimeUnit.SECONDS));
            } finally { release.countDown(); }
        } finally { release.countDown(); }
    }

    @Test public void preflightRunsOffThreadAndRecognizesLocalHosts() throws Exception {
        assumeTrue(Build.VERSION.SDK_INT >= 37);
        assumeTrue(ContextCompat.checkSelfPermission(InstrumentationRegistry.getInstrumentation().getTargetContext(),
            Manifest.permission.ACCESS_LOCAL_NETWORK) != PackageManager.PERMISSION_GRANTED);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            for (String hostname : new String[]{"127.0.0.1", "NAS.LOCAL", "100.64.0.1", "2606:4700:4700::1111"}) {
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
                boolean expected = !hostname.equals("127.0.0.1") && !hostname.equals("2606:4700:4700::1111");
                assertEquals(hostname, expected, result.get(10, TimeUnit.SECONDS).getBoolean("required", false));
            }
        }
    }
}
