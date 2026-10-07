package org.opentubex.app;

import com.getcapacitor.JSObject;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/** Runs the same authenticated Cast V2 sender bundled by Electron. */
final class CastTransport implements AutoCloseable {
    private final Process process;
    private final OutputStreamWriter commands;
    private final Map<Integer, Pending> pending = new ConcurrentHashMap<>();
    private final AtomicInteger nextId = new AtomicInteger();
    private final CompletableFuture<String> connected = new CompletableFuture<>();
    private final Consumer<JSObject> events;
    private final ScheduledExecutorService heartbeat = Executors.newSingleThreadScheduledExecutor();
    private volatile boolean closed;
    private String localAddress;
    private volatile String mediaDestination;
    private volatile int mediaSessionId = -1;
    private volatile int loadRequestId = -1;
    private volatile String mediaContentId;
    private record Pending(String namespace, CompletableFuture<JSObject> response) {}

    CastTransport(String executable, String address, int port, Consumer<JSObject> events) throws Exception {
        this.events = events;
        process = new ProcessBuilder(executable, address, Integer.toString(port)).redirectError(new File("/dev/null")).start();
        commands = new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8);
        Thread reader = new Thread(() -> {
            try (BufferedReader lines = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                for (String line; (line = lines.readLine()) != null;) {
                    if (line.length() > 1_100_000) throw new IllegalArgumentException("Cast message too large");
                    JSObject message = new JSObject(line);
                    if ("connected".equals(message.getString("event"))) {
                        localAddress = message.getString("address");
                        connected.complete(localAddress);
                    }
                    if (!"message".equals(message.getString("event"))) continue;
                    JSObject payload = message.getJSObject("payload");
                    if ("urn:x-cast:com.google.cast.tp.connection".equals(message.getString("namespace")) &&
                        "CLOSE".equals(payload.getString("type"))) { close(); return; }
                    if ("urn:x-cast:com.google.cast.media".equals(message.getString("namespace")) &&
                        "MEDIA_STATUS".equals(payload.getString("type"))) {
                        var statuses = payload.optJSONArray("status");
                        if (statuses != null && statuses.length() > 0) {
                            var status = statuses.getJSONObject(0);
                            int session = status.optInt("mediaSessionId", -1);
                            if (payload.optInt("requestId", -1) == loadRequestId) mediaSessionId = session;
                            var info = status.optJSONObject("media");
                            if (mediaSessionId >= 0 && (session != mediaSessionId || (info != null && info.has("contentId") &&
                                !mediaContentId.equals(info.optString("contentId"))))) { close(); return; }
                        } else if (mediaSessionId >= 0) { close(); return; }
                    }
                    events.accept(message);
                    int requestId = payload.optInt("requestId", -1);
                    Pending request = pending.get(requestId);
                    if (request != null && request.namespace().equals(message.getString("namespace"))) {
                        pending.remove(requestId);
                        CompletableFuture<JSObject> waiting = request.response();
                        if (java.util.Set.of("INVALID_REQUEST", "LOAD_FAILED", "LAUNCH_ERROR").contains(payload.optString("type"))) {
                            waiting.completeExceptionally(new IllegalStateException("Cast " + payload.optString("type")));
                        } else waiting.complete(payload);
                    }
                }
            } catch (Exception ignored) { /* Report a disconnect without logging private media. */ }
            finally { close(); }
        }, "OpenTubeX Cast reader");
        reader.setDaemon(true);
        reader.start();
    }

    String connect() throws Exception {
        String address = connected.get(8, TimeUnit.SECONDS);
        heartbeat.scheduleAtFixedRate(() -> {
            try { send("urn:x-cast:com.google.cast.tp.heartbeat", "receiver-0", new JSObject().put("type", "PING"), false); }
            catch (Exception error) { close(); }
        }, 5, 5, TimeUnit.SECONDS);
        return address;
    }

    String localAddress() { return localAddress; }

    JSObject send(String namespace, String destination, JSObject payload, boolean wait) throws Exception {
        if ("urn:x-cast:com.google.cast.media".equals(namespace)) mediaDestination = destination;
        int id = nextId.incrementAndGet();
        if ("LOAD".equals(payload.getString("type"))) {
            loadRequestId = id;
            mediaContentId = payload.getJSObject("media").getString("contentId");
        }
        CompletableFuture<JSObject> response = new CompletableFuture<>();
        synchronized (this) {
            if (closed) throw new IllegalStateException("Cast device disconnected");
            if (wait) pending.put(id, new Pending(namespace, response));
            commands.write(new JSObject().put("id", id).put("namespace", namespace).put("destination", destination).put("payload", payload) + "\n");
            commands.flush();
        }
        try { return wait ? response.get(8, TimeUnit.SECONDS) : new JSObject(); }
        finally { pending.remove(id); }
    }

    void stopMedia() {
        if (mediaDestination == null || mediaSessionId < 0) return;
        try { send("urn:x-cast:com.google.cast.media", mediaDestination,
            new JSObject().put("type", "STOP").put("mediaSessionId", mediaSessionId), false); }
        catch (Exception ignored) { /* Preserve teardown on disconnect. */ }
    }

    @Override public synchronized void close() {
        if (closed) return;
        closed = true;
        heartbeat.shutdownNow();
        process.destroy();
        connected.completeExceptionally(new IllegalStateException("Cast device disconnected"));
        pending.values().forEach(request -> request.response().completeExceptionally(new IllegalStateException("Cast device disconnected")));
        pending.clear();
        events.accept(new JSObject().put("event", "closed"));
    }
}
