package org.opentubex.app;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import okhttp3.HttpUrl;

@CapacitorPlugin(name = "AndroidLocalNetwork", permissions = {
    @Permission(alias = "localNetwork", strings = { Manifest.permission.ACCESS_LOCAL_NETWORK })
})
public final class AndroidLocalNetworkPlugin extends Plugin {
    private final ExecutorService worker = new ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(64));

    @Override protected void handleOnDestroy() { worker.shutdownNow(); }

    @PluginMethod public void checkAccess(PluginCall call) {
        if (Build.VERSION.SDK_INT < 37 || getPermissionState("localNetwork") == PermissionState.GRANTED) {
            call.resolve(new JSObject().put("required", false));
            return;
        }
        try {
            worker.execute(() -> {
                try { checkAccessOnWorker(call); }
                catch (Exception error) { call.reject("Unable to check local access", error); }
            });
        } catch (RejectedExecutionException error) {
            call.reject("Too many pending local access checks");
        }
    }

    private void checkAccessOnWorker(PluginCall call) {
        String host = call.getString("hostname");
        String rawUrl = call.getString("url");
        if (rawUrl != null) {
            HttpUrl url = HttpUrl.parse(rawUrl);
            if (url == null) { call.reject("Invalid network URL"); return; }
            host = url.host();
            if (!call.getBoolean("direct", false)) host = AndroidProxy.connectionHost(url.uri());
        }
        // Casting discovery always needs LAN access. HTTP follows the configured
        // proxy, so never resolve a destination that belongs to the proxy's DNS.
        boolean required = host == null;
        if (host != null) {
            if (host.toLowerCase(Locale.ROOT).endsWith(".local")) required = true;
            else try {
                for (InetAddress address : InetAddress.getAllByName(host)) {
                    if (isLocalNetwork(address)) { required = true; break; }
                }
            } catch (UnknownHostException ignored) {
                // Preserve the HTTP client's existing DNS errors and retry policy.
            }
        }
        call.resolve(new JSObject().put("required", required));
    }

    static boolean isLocalNetwork(InetAddress address) {
        if (address.isLoopbackAddress() || address.isAnyLocalAddress()) return false;
        byte[] bytes = address.getAddress();
        // Include Android's CGNAT and IPv4 limited-broadcast ranges.
        return address.isSiteLocalAddress() || address.isLinkLocalAddress() || address.isMulticastAddress() ||
            (bytes.length == 4 && bytes[0] == 100 && (bytes[1] & 0xc0) == 0x40) ||
            (bytes.length == 4 && bytes[0] == -1 && bytes[1] == -1 && bytes[2] == -1 && bytes[3] == -1) ||
            (bytes.length == 16 && (bytes[0] & 0xfe) == 0xfc);
    }
}
