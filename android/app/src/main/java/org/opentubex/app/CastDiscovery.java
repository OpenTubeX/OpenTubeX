package org.opentubex.app;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.wifi.WifiManager;
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
    static JSArray discover(Context context) throws Exception { return discover(context, false); }

    /** Google Cast receivers by default, or FCast receivers. */
    static JSArray discover(Context context, boolean fcast) throws Exception {
        WifiManager wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        WifiManager.MulticastLock lock = wifi.createMulticastLock("OpenTubeX Cast discovery");
        lock.acquire();
        try { return discoverNsd(context, fcast); }
        finally { lock.release(); }
    }

    private static JSArray discoverNsd(Context context, boolean fcast) throws Exception {
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
        nsd.discoverServices(fcast ? "_fcast._tcp." : "_googlecast._tcp.", NsdManager.PROTOCOL_DNS_SD, listener);
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
            String address = value.getHost().getHostAddress();
            if (fcast) {
                // FCast receivers have no TXT name; their instance name is the display name.
                String name = unescapeLabel(value.getServiceName());
                if (!name.isEmpty() && name.length() <= 256) {
                    devices.put(name, new JSObject().put("id", name).put("name", name).put("address", address).put("port", value.getPort()));
                }
                continue;
            }
            Map<String, byte[]> attributes = value.getAttributes();
            String id = text(attributes, "id");
            String name = text(attributes, "fn");
            int capabilities;
            try { capabilities = Integer.parseInt(text(attributes, "ca")); } catch (NumberFormatException error) { continue; }
            if (id.isEmpty() || id.length() > 256 || name.isEmpty() || name.length() > 256 || (capabilities & 1) == 0) continue;
            devices.put(id, new JSObject().put("id", id).put("name", name).put("address", address).put("port", value.getPort()));
        }
        JSArray result = new JSArray();
        devices.values().forEach(result::put);
        return result;
    }

    /** Some Android versions return DNS presentation escapes such as {@code \032} in service names. */
    static String unescapeLabel(String label) {
        var bytes = new java.io.ByteArrayOutputStream();
        byte[] raw = label.getBytes(StandardCharsets.UTF_8);
        for (int index = 0; index < raw.length; index++) {
            if (raw[index] != '\\' || index + 1 >= raw.length) { bytes.write(raw[index]); continue; }
            if (index + 3 < raw.length && Character.isDigit(raw[index + 1]) && Character.isDigit(raw[index + 2]) && Character.isDigit(raw[index + 3])) {
                int value = Integer.parseInt(new String(raw, index + 1, 3, StandardCharsets.US_ASCII));
                if (value < 256) { bytes.write(value); index += 3; continue; }
            }
            bytes.write(raw[++index]);
        }
        return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
    }

    private static String text(Map<String, byte[]> attributes, String key) {
        byte[] bytes = attributes.get(key);
        return bytes == null ? "" : new String(bytes, StandardCharsets.UTF_8);
    }
}
