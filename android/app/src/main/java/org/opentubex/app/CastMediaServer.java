package org.opentubex.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Native streaming; only small manifests cross the bridge for shared rewriting. */
final class CastMediaServer implements AutoCloseable {
    // DASH receivers may probe many representations while keeping earlier streams open.
    private static final int MAX_CONNECTIONS = 64;
    private final ServerSocket server;
    private final String peer;
    private final String castId;
    private final Consumer<JSObject> manifests;
    private final Map<Integer, JSObject> resources = new ConcurrentHashMap<>();
    private record Manifest(int resourceId, CompletableFuture<String> body) {}
    private final Map<String, Manifest> pending = new ConcurrentHashMap<>();
    private final Map<Integer, Integer> hlsReadTimeouts = new ConcurrentHashMap<>();
    private final Set<Socket> sockets = ConcurrentHashMap.newKeySet();
    private final Semaphore slots = new Semaphore(MAX_CONNECTIONS);
    private final ExecutorService workers = Executors.newFixedThreadPool(MAX_CONNECTIONS);
    private final OkHttpClient client;

    CastMediaServer(String local, String peer, String castId, DlnaAuthorization authorization, Consumer<JSObject> manifests) throws Exception {
        this(local, peer, castId, authorization, manifests, new OkHttpClient());
    }

    CastMediaServer(String local, String peer, String castId, DlnaAuthorization authorization, Consumer<JSObject> manifests, OkHttpClient upstream) throws Exception {
        this.peer = peer;
        this.castId = castId;
        this.manifests = manifests;
        client = CastMediaDestinations.restrict(upstream).newBuilder().cookieJar(CookieJar.NO_COOKIES)
            .connectTimeout(10, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
            .addNetworkInterceptor(chain -> {
                Request.Builder request = chain.request().newBuilder();
                for (String name : new String[]{"Cookie", "Authorization", "Origin", "Referer"}) request.removeHeader(name);
                HttpUrl original = chain.request().tag(HttpUrl.class);
                if (original != null) {
                    var headers = ExternalStreamRequestRegistry.shared().headersForRedirect(original.url(), chain.request().url().url());
                    if (headers != null) headers.forEach(request::header);
                    if (authorization != null) authorization.apply(request, original, chain.request().url());
                }
                return chain.proceed(request.build());
            }).build();
        server = new ServerSocket(0, MAX_CONNECTIONS, InetAddress.getByName(local));
        Thread listener = new Thread(this::accept, "OpenTubeX Cast relay");
        listener.setDaemon(true);
        listener.start();
    }

    String origin() { return "http://" + server.getInetAddress().getHostAddress() + ":" + server.getLocalPort(); }

    synchronized void register(JSArray batch) throws Exception {
        register(batch, new JSArray());
    }

    synchronized void register(JSArray batch, JSArray removals) throws Exception {
        if (batch.length() > 65_536 || removals.length() > 65_536) throw new IllegalArgumentException("Too many Cast resources");
        var removed = new HashSet<Integer>();
        for (int index = 0; index < removals.length(); index++) {
            Object value = removals.get(index);
            if (!(value instanceof Number number) || number.doubleValue() != number.intValue() || number.intValue() < 0 ||
                !removed.add(number.intValue())) throw new IllegalArgumentException("Invalid Cast resource removal");
        }
        long retired = removed.stream().filter(resources::containsKey).count();
        if (resources.size() - retired + batch.length() > 65_536) throw new IllegalArgumentException("Too many Cast resources");
        var additions = new java.util.HashMap<Integer, JSObject>();
        for (int index = 0; index < batch.length(); index++) {
            JSObject resource = JSObject.fromJSONObject(batch.getJSONObject(index));
            if (resource.has("contentType")) {
                Object contentType = resource.get("contentType");
                if (!(contentType instanceof String type) || type.length() > 256 ||
                    type.chars().anyMatch(character -> character < 32 || character == 127)) {
                    throw new IllegalArgumentException("Invalid Cast resource content type");
                }
            }
            int id = resource.optInt("id", -1);
            if (id < 0 || resources.containsKey(id) || additions.containsKey(id)) throw new IllegalArgumentException("Invalid Cast resource ID");
            var candidates = resource.getJSONArray("candidates");
            if (candidates.length() == 0 || candidates.length() > 64) throw new IllegalArgumentException("Invalid Cast resource alternatives");
            for (int item = 0; item < candidates.length(); item++) {
                String url = candidates.getJSONObject(item).getString("url");
                if (url.startsWith("data:")) {
                    if (url.length() > 25_166_000 || !url.matches("(?is)data:(application/(dash\\+xml|x-mpegurl|vnd\\.apple\\.mpegurl)|text/vtt)(;charset=utf-8)?,.*")) {
                        throw new IllegalArgumentException("Invalid inline Cast resource");
                    }
                } else {
                    HttpUrl parsed = HttpUrl.parse(url);
                    if (url.length() > 16_000 || parsed == null || !parsed.username().isEmpty() || !parsed.password().isEmpty()) {
                        throw new IllegalArgumentException("Invalid Cast resource URL");
                    }
                }
            }
            additions.put(id, resource);
        }
        removed.forEach(id -> { resources.remove(id); hlsReadTimeouts.remove(id); });
        resources.putAll(additions);
    }

    synchronized void complete(String id, String body, Integer hlsReadTimeout) {
        Manifest manifest = id == null ? null : pending.remove(id);
        if (manifest != null) {
            CompletableFuture<String> future = manifest.body();
            if (body != null && hlsReadTimeout != null && resources.containsKey(manifest.resourceId())) {
                hlsReadTimeouts.put(manifest.resourceId(), Math.max(0, hlsReadTimeout));
            }
            if (body == null || body.length() > 8_000_000) future.completeExceptionally(new IllegalArgumentException("Invalid Cast manifest"));
            else future.complete(body);
        }
    }

    private void accept() {
        while (!server.isClosed()) {
            try {
                Socket socket = server.accept();
                if (!peer.equals(socket.getInetAddress().getHostAddress()) || !slots.tryAcquire()) { socket.close(); continue; }
                sockets.add(socket);
                try {
                    workers.execute(() -> {
                        try (socket) {
                            try { serve(socket); }
                            catch (Exception error) { reply(socket.getOutputStream(), 502, "text/plain", new byte[0], true); }
                        } catch (Exception ignored) { /* Receiver disconnected. */ }
                        finally { sockets.remove(socket); slots.release(); }
                    });
                } catch (RuntimeException error) { sockets.remove(socket); slots.release(); socket.close(); }
            } catch (Exception ignored) { close(); }
        }
    }

    private static boolean manifest(String type) {
        return Set.of("application/dash+xml", "application/x-mpegurl", "application/vnd.apple.mpegurl").contains(type);
    }

    private static byte[] manifestBody(Response response) throws Exception {
        InputStream body = response.body().byteStream();
        String[] encodings = String.join(",", response.headers("Content-Encoding")).toLowerCase(java.util.Locale.ROOT).split(",");
        for (int index = encodings.length - 1; index >= 0; index--) {
            body = switch (encodings[index].trim()) {
                case "", "identity" -> body;
                case "gzip" -> new java.util.zip.GZIPInputStream(body);
                case "deflate" -> new java.util.zip.InflaterInputStream(body);
                case "br" -> new org.brotli.dec.BrotliInputStream(body);
                default -> throw new IllegalArgumentException("Unsupported Cast manifest encoding");
            };
        }
        // Bound decoded bytes too, so compressed manifests cannot bypass the limit.
        try (InputStream decoded = body; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            for (int count; (count = decoded.read(buffer, 0, Math.min(buffer.length, 2_000_001 - output.size()))) != -1;) {
                output.write(buffer, 0, count);
                if (output.size() > 2_000_000) throw new IllegalArgumentException("Cast manifest too large");
            }
            return output.toByteArray();
        }
    }

    private static HttpUrl applyHlsReloadQuery(HttpUrl url, String query) throws Exception {
        if (query.length() > 512) throw new IllegalArgumentException("Invalid HLS reload query");
        var names = new HashSet<String>();
        var builder = url.newBuilder();
        for (String directive : query.split("&")) {
            if (directive.isEmpty()) continue;
            String[] pair = directive.split("=", 2);
            String name = URLDecoder.decode(pair[0], "UTF-8");
            String value = pair.length == 2 ? URLDecoder.decode(pair[1], "UTF-8") : "";
            boolean valid = name.equals("_HLS_skip") ? Set.of("YES", "v2").contains(value)
                : Set.of("_HLS_msn", "_HLS_part").contains(name) && value.matches("[0-9]{1,20}");
            if (!valid || !names.add(name)) throw new IllegalArgumentException("Invalid HLS reload query");
            // OkHttp keeps every untouched signed query value in its encoded form.
            builder.removeAllQueryParameters(name).addQueryParameter(name, value);
        }
        if (names.contains("_HLS_part") && !names.contains("_HLS_msn") && url.queryParameter("_HLS_msn") == null) {
            throw new IllegalArgumentException("Invalid HLS reload query");
        }
        return builder.build();
    }

    private static Thread watchReceiver(Socket socket, okhttp3.Call call, java.util.concurrent.atomic.AtomicBoolean finished) throws Exception {
        socket.setSoTimeout(1000);
        Thread watcher = new Thread(() -> {
            try {
                while (!finished.get()) {
                    try {
                        if (socket.getInputStream().read() == -1) { call.cancel(); return; }
                    } catch (java.net.SocketTimeoutException expected) { /* Check request completion. */ }
                }
            } catch (Exception error) { if (!finished.get()) call.cancel(); }
        }, "OpenTubeX Cast blocking reload");
        watcher.setDaemon(true);
        watcher.start();
        return watcher;
    }

    private void serve(Socket socket) throws Exception {
        socket.setSoTimeout(10_000);
        InputStream input = socket.getInputStream();
        OutputStream output = socket.getOutputStream();
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        while (header.size() < 8192) {
            int value = input.read();
            if (value < 0) return;
            header.write(value);
            byte[] bytes = header.toByteArray();
            if (bytes.length >= 4 && bytes[bytes.length - 4] == '\r' && bytes[bytes.length - 3] == '\n' && bytes[bytes.length - 2] == '\r' && bytes[bytes.length - 1] == '\n') break;
        }
        String[] lines = header.toString(StandardCharsets.US_ASCII.name()).split("\r\n");
        String[] request = lines[0].split(" ");
        if (header.size() >= 8192 || request.length != 3 || !Set.of("GET", "HEAD", "OPTIONS").contains(request[0])) {
            reply(output, 404, "text/plain", new byte[0], true); return;
        }
        String prefix = "/" + castId + "/";
        if (!request[1].startsWith(prefix)) { reply(output, 404, "text/plain", new byte[0], true); return; }
        String[] path = request[1].substring(prefix.length()).split("/", 2);
        int id;
        try { id = Integer.parseInt(path[0]); } catch (NumberFormatException error) { reply(output, 404, "text/plain", new byte[0], true); return; }
        JSObject resource = resources.get(id);
        if (resource == null || path.length != 2) { reply(output, 404, "text/plain", new byte[0], true); return; }
        if (request[0].equals("OPTIONS")) { reply(output, 204, "text/plain", new byte[0], true); return; }
        boolean head = request[0].equals("HEAD");
        var candidates = resource.getJSONArray("candidates");
        for (int attempt = 0; attempt < candidates.length(); attempt++) {
            try {
                var candidate = candidates.getJSONObject(attempt);
                String url = candidate.getString("url");
                String type = resource.getString("contentType", "");
                if (url.startsWith("data:")) {
                    if (!path[1].equals("media")) throw new IllegalArgumentException("Invalid inline path");
                    String body = URLDecoder.decode(url.substring(url.indexOf(',') + 1).replace("+", "%2B"), "UTF-8");
                    if (body.getBytes(StandardCharsets.UTF_8).length > (type.equals("text/vtt") ? 8 * 1024 * 1024 : 2_000_000)) throw new IllegalArgumentException("Inline resource too large");
                    if (manifest(type)) body = rewrite(id, body, null, type);
                    reply(output, 200, type, body.getBytes(StandardCharsets.UTF_8), head); return;
                }
                HttpUrl original = HttpUrl.get(url);
                HttpUrl target = original;
                String resourcePath = path[1];
                int queryStart = resourcePath.indexOf('?');
                boolean hls = Set.of("application/x-mpegurl", "application/vnd.apple.mpegurl").contains(type) ||
                    (type.isEmpty() && original.encodedPath().toLowerCase(java.util.Locale.ROOT).endsWith(".m3u8"));
                String reloadQuery = queryStart >= 0 && hls ? resourcePath.substring(queryStart + 1) : null;
                if (reloadQuery != null) resourcePath = resourcePath.substring(0, queryStart);
                if (candidate.optBoolean("template")) {
                    target = original.resolve(resourcePath);
                    if (target == null || !target.scheme().equals(original.scheme()) || !target.host().equals(original.host()) || target.port() != original.port() ||
                        !target.encodedPath().startsWith(original.encodedPath()) || target.encodedPath().matches("(?i).*%(2e|2f|5c|25).*")) throw new IllegalArgumentException("Invalid Cast template path");
                } else if (!resourcePath.equals("media")) throw new IllegalArgumentException("Invalid Cast resource path");
                if (reloadQuery != null) target = applyHlsReloadQuery(target, reloadQuery);
                Request.Builder upstream = new Request.Builder().url(target).tag(HttpUrl.class, original).method(request[0], null)
                    .header("Accept-Encoding", "identity");
                for (String line : lines) if (line.regionMatches(true, 0, "Range:", 0, 6)) upstream.header("Range", line.substring(6).trim());
                boolean blocking = hls && request[0].equals("GET") && !candidate.optBoolean("template") &&
                    target.queryParameter("_HLS_msn") != null && target.queryParameter("_HLS_msn").matches("[0-9]{1,20}");
                // Unknown timing must allow the server to wait for a future segment.
                OkHttpClient requestClient = blocking ? client.newBuilder()
                    .readTimeout(hlsReadTimeouts.getOrDefault(id, 0), TimeUnit.MILLISECONDS).build() : client;
                var call = requestClient.newCall(upstream.build());
                var finished = new java.util.concurrent.atomic.AtomicBoolean();
                Thread watcher = blocking ? watchReceiver(socket, call, finished) : null;
                try (Response response = call.execute()) {
                    // Only the blocking header wait is extended, not body streaming.
                    if (response.body() != null) response.body().source().timeout().timeout(30, TimeUnit.SECONDS);
                    if (!response.isSuccessful() && attempt + 1 < candidates.length()) continue;
                    if (type.isEmpty()) type = response.header("Content-Type", "application/octet-stream").split(";", 2)[0].trim().toLowerCase(java.util.Locale.ROOT);
                    String finalUrl = response.request().url().toString();
                    if (response.request().url().encodedPath().endsWith(".mpd")) type = "application/dash+xml";
                    if (response.request().url().encodedPath().endsWith(".m3u8")) type = "application/x-mpegurl";
                    if (manifest(type) && response.isSuccessful() && !head && response.body() != null) {
                        byte[] bytes = manifestBody(response);
                        String body = rewrite(id, new String(bytes, StandardCharsets.UTF_8), finalUrl, type);
                        reply(output, response.code(), type, body.getBytes(StandardCharsets.UTF_8), false); return;
                    }
                    StringBuilder headers = new StringBuilder("HTTP/1.1 " + response.code() + " OK\r\nContent-Type: " + type + "\r\n" + cors());
                    // Streams stay encoded, so retain the encoding and matching byte metadata.
                    for (String name : new String[]{"Content-Encoding", "Content-Length", "Content-Range", "Accept-Ranges", "Date"}) {
                        String value = name.equals("Content-Encoding") ? String.join(", ", response.headers(name)) : response.header(name);
                        if (value != null && !value.isEmpty()) headers.append(name).append(": ").append(value).append("\r\n");
                    }
                    output.write(headers.append("Connection: close\r\n\r\n").toString().getBytes(StandardCharsets.US_ASCII));
                    if (!head && response.body() != null) {
                        InputStream body = response.body().byteStream();
                        byte[] buffer = new byte[32 * 1024];
                        for (int count; (count = body.read(buffer)) != -1;) output.write(buffer, 0, count);
                    }
                    return;
                } finally {
                    finished.set(true);
                    if (watcher != null) watcher.interrupt();
                }
            } catch (Exception error) { if (attempt + 1 == candidates.length()) throw error; }
        }
    }

    private String rewrite(int resourceId, String body, String url, String type) throws Exception {
        String id = UUID.randomUUID().toString();
        CompletableFuture<String> future = new CompletableFuture<>();
        pending.put(id, new Manifest(resourceId, future));
        try {
            manifests.accept(new JSObject().put("castId", castId).put("requestId", id).put("resourceId", resourceId)
                .put("body", body).put("url", url).put("contentType", type));
            return future.get(10, TimeUnit.SECONDS);
        } finally { pending.remove(id); }
    }

    private static String cors() {
        return "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\nAccess-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, Date\r\n";
    }

    private static void reply(OutputStream output, int code, String type, byte[] bytes, boolean head) throws Exception {
        output.write(("HTTP/1.1 " + code + " OK\r\nContent-Type: " + type + "\r\nContent-Length: " + bytes.length + "\r\n" + cors() + "Connection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        if (!head) output.write(bytes);
    }

    @Override public void close() {
        try { server.close(); } catch (Exception ignored) {}
        for (Socket socket : sockets) try { socket.close(); } catch (Exception ignored) {}
        pending.values().forEach(manifest -> manifest.body().completeExceptionally(new IllegalStateException("Cast relay closed")));
        pending.clear();
        workers.shutdownNow();
        client.dispatcher().cancelAll();
        client.connectionPool().evictAll();
    }
}
