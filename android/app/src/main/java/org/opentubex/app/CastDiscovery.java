package org.opentubex.app;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.net.Inet4Address;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;

/** Android NSD avoids the app UID's restricted network-interface enumeration. */
final class CastDiscovery {
    static JSArray discover(Context context) throws Exception {
        NsdManager nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        var found = new CopyOnWriteArrayList<NsdServiceInfo>();
        var started = new CompletableFuture<Void>();
        var stopped = new CompletableFuture<Void>();
        NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            @Override public void onDiscoveryStarted(String type) { started.complete(null); }
            @Override public void onStartDiscoveryFailed(String type, int code) {
                started.completeExceptionally(new IllegalStateException("Cast discovery failed: " + code));
            }
            @Override public void onDiscoveryStopped(String type) { stopped.complete(null); }
            @Override public void onStopDiscoveryFailed(String type, int code) { stopped.complete(null); }
            @Override public void onServiceFound(NsdServiceInfo service) { if (found.size() < 64) found.add(service); }
            @Override public void onServiceLost(NsdServiceInfo service) { found.removeIf(item -> item.getServiceName().equals(service.getServiceName())); }
        };
        nsd.discoverServices("_googlecast._tcp.", NsdManager.PROTOCOL_DNS_SD, listener);
        try {
            started.get(2, TimeUnit.SECONDS);
            // Let one bounded browse collect devices before serial resolution,
            // as old Android versions reject overlapping resolve requests.
            try { stopped.get(2500, TimeUnit.MILLISECONDS); } catch (java.util.concurrent.TimeoutException expected) {}
        } finally { nsd.stopServiceDiscovery(listener); }
        Map<String, JSObject> devices = new LinkedHashMap<>();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        for (NsdServiceInfo service : found) {
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) break;
            CompletableFuture<NsdServiceInfo> resolved = new CompletableFuture<>();
            nsd.resolveService(service, new NsdManager.ResolveListener() {
                @Override public void onResolveFailed(NsdServiceInfo value, int code) { resolved.complete(null); }
                @Override public void onServiceResolved(NsdServiceInfo value) { resolved.complete(value); }
            });
            NsdServiceInfo value;
            try { value = resolved.get(remaining, TimeUnit.NANOSECONDS); }
            catch (java.util.concurrent.TimeoutException expected) { break; }
            if (value == null || !(value.getHost() instanceof Inet4Address) || value.getPort() < 1 || value.getPort() > 65535) continue;
            Map<String, byte[]> attributes = value.getAttributes();
            String id = text(attributes, "id");
            String name = text(attributes, "fn");
            int capabilities;
            try { capabilities = Integer.parseInt(text(attributes, "ca")); } catch (NumberFormatException error) { continue; }
            if (id.isEmpty() || id.length() > 256 || name.isEmpty() || name.length() > 256 || (capabilities & 1) == 0) continue;
            devices.put(id, new JSObject().put("id", id).put("name", name).put("address", value.getHost().getHostAddress()).put("port", value.getPort()));
        }
        JSArray result = new JSArray();
        devices.values().forEach(result::put);
        return result;
    }

    private static String text(Map<String, byte[]> attributes, String key) {
        byte[] bytes = attributes.get(key);
        return bytes == null ? "" : new String(bytes, StandardCharsets.UTF_8);
    }
}
