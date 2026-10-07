package org.opentubex.app;

import android.content.Context;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "Chromecast")
public final class ChromecastPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService discoveryWorker = Executors.newSingleThreadExecutor();
    // Receiver LOAD waits on control; its manifest requests must progress independently.
    private final ExecutorService mediaWorker = Executors.newSingleThreadExecutor();
    private final Map<String, JSObject> devices = new ConcurrentHashMap<>();
    private volatile CastTransport transport;
    private volatile CastMediaServer media;
    private volatile String castId;
    private volatile boolean destroyed;

    private String executable() {
        return new File(getContext().getApplicationInfo().nativeLibraryDir, "libopentubex_cast.so").getAbsolutePath();
    }

    @PluginMethod public void discover(PluginCall call) {
        discoveryWorker.execute(() -> {
            try {
                if (destroyed) throw new IllegalStateException("Cast plugin closed");
                JSArray found = CastDiscovery.discover(getContext());
                for (int index = 0; index < found.length(); index++) {
                    JSObject device = JSObject.fromJSONObject(found.getJSONObject(index));
                    devices.put(device.getString("id"), device);
                }
                call.resolve(new JSObject().put("devices", found));
            } catch (Exception error) { call.reject("Unable to discover Cast devices", error); }
        });
    }

    @PluginMethod public void connect(PluginCall call) {
        worker.execute(() -> {
            JSObject device = devices.get(call.getString("deviceId", ""));
            String id = call.getString("castId", "");
            if (destroyed || transport != null || device == null || !id.matches("[a-fA-F0-9-]{36}")) {
                call.reject("Invalid Cast device or another cast is active"); return;
            }
            try {
                castId = id;
                peerAddress = device.getString("address");
                transport = new CastTransport(executable(), device.getString("address"), device.optInt("port"), event -> {
                    notifyListeners("castEvent", event.put("castId", id));
                    if ("closed".equals(event.getString("event"))) {
                        try { worker.execute(() -> { if (id.equals(castId)) cleanup(); }); }
                        catch (java.util.concurrent.RejectedExecutionException ignored) { /* Destruction already cleans up. */ }
                    }
                });
                call.resolve(new JSObject().put("address", transport.connect()));
            } catch (Exception error) { cleanup(); call.reject("Unable to connect to Cast device", error); }
        });
    }

    private boolean owns(PluginCall call) {
        return !destroyed && transport != null && castId != null && castId.equals(call.getString("castId"));
    }

    @PluginMethod public void send(PluginCall call) {
        worker.execute(() -> {
            String namespace = call.getString("namespace", "");
            String destination = call.getString("destination", "");
            JSObject payload = call.getObject("payload");
            if (!owns(call) || payload == null || !java.util.Set.of("urn:x-cast:com.google.cast.tp.connection",
                "urn:x-cast:com.google.cast.receiver", "urn:x-cast:com.google.cast.media",
                "urn:x-cast:com.google.cast.tp.heartbeat").contains(namespace) ||
                destination.isEmpty() || destination.length() > 256 || payload.toString().length() > 1_000_000) {
                call.reject("Invalid Cast command"); return;
            }
            try { call.resolve(transport.send(namespace, destination, payload, call.getBoolean("wait", true))); }
            catch (Exception error) { call.reject("Cast command failed", error); }
        });
    }

    @PluginMethod public void openMedia(PluginCall call) {
        worker.execute(() -> {
            if (!owns(call) || media != null) { call.reject("Cast session unavailable"); return; }
            try {
                // The peer is retained at connection time, independent of later discovery.
                media = new CastMediaServer(transport.localAddress(), peerAddress, castId,
                    call.getObject("authorization") == null ? null : new DlnaAuthorization(call.getObject("authorization")),
                    event -> notifyListeners("castManifest", event));
                CastService.start(getContext(), castId, () -> stopFromService(call.getString("castId")));
                call.resolve(new JSObject().put("origin", media.origin()));
            } catch (Exception error) { cleanup(); call.reject("Unable to start Cast media relay", error); }
        });
    }

    private String peerAddress;

    @PluginMethod public void registerResources(PluginCall call) {
        mediaWorker.execute(() -> {
            try {
                CastMediaServer server = media;
                if (!owns(call) || server == null) throw new IllegalStateException("Cast relay closed");
                server.register(call.getArray("resources", new JSArray()), call.getArray("removeResourceIds", new JSArray()));
                call.resolve();
            } catch (Exception error) { call.reject("Invalid Cast resources", error); }
        });
    }

    @PluginMethod public void completeManifest(PluginCall call) {
        mediaWorker.execute(() -> {
            CastMediaServer server = media;
            if (owns(call) && server != null) server.complete(call.getString("requestId"),
                call.getBoolean("error", false) ? null : call.getString("body"));
            call.resolve();
        });
    }

    @PluginMethod public void disconnect(PluginCall call) {
        worker.execute(() -> { if (owns(call)) cleanup(); call.resolve(); });
    }

    private void stopFromService(String id) {
        try { worker.execute(() -> {
            if (!id.equals(castId)) return;
            if (transport != null) transport.stopMedia();
            cleanup();
        }); } catch (java.util.concurrent.RejectedExecutionException ignored) { /* Destruction already cleans up. */ }
    }

    private void cleanup() {
        String id = castId;
        CastTransport sender = transport;
        transport = null;
        if (sender != null) sender.close();
        CastMediaServer relay = media;
        media = null;
        if (relay != null) relay.close();
        castId = null;
        CastService.stop(getContext(), id);
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        discoveryWorker.shutdownNow();
        mediaWorker.shutdown();
        worker.execute(this::cleanup);
        worker.shutdown();
        super.handleOnDestroy();
    }
}
