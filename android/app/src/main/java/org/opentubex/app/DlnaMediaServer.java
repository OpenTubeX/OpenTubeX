package org.opentubex.app;

import android.content.Context;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ScheduledExecutorService;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** A per-cast relay: bounded native streaming, with no media bytes on the bridge. */
final class DlnaMediaServer implements AutoCloseable {
    private final ServerSocket server;
    private final String address;
    private final HttpUrl media;
    final String castId = UUID.randomUUID().toString();
    private final Set<Socket> sockets = ConcurrentHashMap.newKeySet();
    private final Semaphore slots = new Semaphore(4);
    private final ExecutorService workers = Executors.newFixedThreadPool(4);
    private final OkHttpClient client;

    private Context context;
    private List<DlnaMediaServer> sources = List.of();
    private double startSeconds;
    private final Set<Process> processes = ConcurrentHashMap.newKeySet();
    private final ScheduledExecutorService timers = Executors.newSingleThreadScheduledExecutor();

    DlnaMediaServer(Context context, HttpUrl media, HttpUrl audio, String address, InetAddress local, double startSeconds) throws Exception {
        this(media, address, local);
        this.context = context;
        this.startSeconds = Double.isFinite(startSeconds) ? Math.max(0, startSeconds) : 0;
        if (audio != null) {
            List<DlnaMediaServer> inputs = new ArrayList<>();
            try {
                YtDlpRuntime.initialize(context);
                for (HttpUrl source : new HttpUrl[]{media, audio}) {
                    inputs.add(new DlnaMediaServer(source, "127.0.0.1", InetAddress.getByName("127.0.0.1")));
                }
                sources = inputs;
            } catch (Exception error) {
                for (DlnaMediaServer input : inputs) input.close();
                close();
                throw error;
            }
        }
    }

    DlnaMediaServer(HttpUrl media, String address, InetAddress local) throws IOException {
        this.media = media;
        this.address = address;
        client = new OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
            .connectTimeout(10, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
            .addNetworkInterceptor(chain -> {
                Request.Builder request = chain.request().newBuilder();
                // Re-evaluate native yt-dlp credentials at each redirect destination.
                for (String name : new String[]{"Cookie", "Authorization", "Origin", "Referer"}) request.removeHeader(name);
                var headers = ExternalStreamRequestRegistry.shared().headersForRedirect(media.url(), chain.request().url().url());
                if (headers != null) headers.forEach(request::header);
                return chain.proceed(request.build());
            }).build();
        server = new ServerSocket(0, 4, local);
        Thread listener = new Thread(this::accept, "OpenTubeX DLNA relay");
        listener.setDaemon(true);
        listener.start();
    }

    String mediaUrl() {
        return "http://" + server.getInetAddress().getHostAddress() + ":" + server.getLocalPort() +
            "/" + castId + "/video.mp4";
    }

    private void accept() {
        while (!server.isClosed()) {
            try {
                Socket socket = server.accept();
                if (!address.equals(socket.getInetAddress().getHostAddress()) || !slots.tryAcquire()) {
                    socket.close();
                    continue;
                }
                sockets.add(socket);
                try {
                    workers.execute(() -> {
                        try (socket) { serve(socket); } catch (IOException ignored) { /* Disconnected renderer. */ }
                        finally { sockets.remove(socket); slots.release(); }
                    });
                } catch (RuntimeException error) {
                    sockets.remove(socket);
                    slots.release();
                    socket.close();
                }
            } catch (IOException ignored) { close(); }
        }
    }

    private void serve(Socket socket) throws IOException {
        socket.setSoTimeout(10_000);
        InputStream input = socket.getInputStream();
        OutputStream output = socket.getOutputStream();
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        int tail = 0;
        while (header.size() < 8192) {
            int value = input.read();
            if (value < 0) return;
            header.write(value);
            tail = (tail << 8) | value;
            if (tail == 0x0d0a0d0a) break;
        }
        String[] lines = header.toString(StandardCharsets.US_ASCII.name()).split("\r\n");
        String[] request = lines[0].split(" ");
        if (header.size() >= 8192 || request.length != 3 ||
            !(request[0].equals("GET") || request[0].equals("HEAD")) ||
            !request[1].equals("/" + castId + "/video.mp4")) {
            output.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .getBytes(StandardCharsets.US_ASCII));
            return;
        }
        if (!sources.isEmpty()) {
            for (String line : lines) {
                if (line.regionMatches(true, 0, "Range:", 0, 6) && !line.substring(6).trim().matches("bytes=0-")) {
                    output.write("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Length: 0\r\nAccept-Ranges: none\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                    return;
                }
            }
            serveMerged(request[0].equals("HEAD"), output);
            return;
        }
        Request.Builder upstream = new Request.Builder().url(media).method(request[0], null)
            .header("Accept-Encoding", "identity")
            .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36");
        for (int index = 1; index < lines.length; index++) {
            if (lines[index].regionMatches(true, 0, "Range:", 0, 6)) {
                upstream.header("Range", lines[index].substring(6).trim());
            }
        }
        try (Response response = client.newCall(upstream.build()).execute()) {
            StringBuilder headers = new StringBuilder("HTTP/1.1 " + response.code() + " " + response.message() +
                "\r\nContent-Type: video/mp4\r\ntransferMode.dlna.org: Streaming\r\nConnection: close\r\n");
            for (String name : new String[]{"Content-Length", "Content-Range", "Accept-Ranges"}) {
                String value = response.header(name);
                if (value != null) headers.append(name).append(": ").append(value).append("\r\n");
            }
            output.write(headers.append("\r\n").toString().getBytes(StandardCharsets.US_ASCII));
            if (!request[0].equals("HEAD") && response.body() != null) {
                byte[] buffer = new byte[32 * 1024];
                InputStream body = response.body().byteStream();
                for (int count; (count = body.read(buffer)) != -1;) output.write(buffer, 0, count);
            }
        }
    }

    private void serveMerged(boolean head, OutputStream output) throws IOException {
        byte[] headers = "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nAccept-Ranges: none\r\ntransferMode.dlna.org: Streaming\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII);
        if (head) { output.write(headers); return; }
        Process process = null;
        try {
            List<String> args = new ArrayList<>(Arrays.asList("-nostdin", "-hide_banner", "-loglevel", "error"));
            for (DlnaMediaServer source : sources) {
                if (startSeconds > 0) args.addAll(Arrays.asList("-ss", Double.toString(startSeconds)));
                args.addAll(Arrays.asList("-i", source.mediaUrl()));
            }
            args.addAll(Arrays.asList("-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags",
                "+frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"));
            process = YtDlpRuntime.startDlnaFfmpeg(context, args);
            processes.add(process);
            Process running = process;
            var timeout = timers.schedule(running::destroy, 15, TimeUnit.SECONDS);
            InputStream merged = process.getInputStream();
            byte[] buffer = new byte[32 * 1024];
            int first = merged.read(buffer);
            timeout.cancel(false);
            if (first < 0) {
                output.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                return;
            }
            output.write(headers);
            output.write(buffer, 0, first);
            for (int count; (count = merged.read(buffer)) != -1;) output.write(buffer, 0, count);
        } catch (Exception error) { throw new IOException("DLNA stream merge failed", error); }
        finally {
            if (process != null) { process.destroy(); processes.remove(process); }
        }
    }

    @Override public void close() {
        try { server.close(); } catch (IOException ignored) {}
        for (Socket socket : sockets) {
            try { socket.close(); } catch (IOException ignored) {}
        }
        for (Process process : processes) process.destroy();
        for (DlnaMediaServer source : sources) source.close();
        timers.shutdownNow();
        client.dispatcher().cancelAll();
        client.connectionPool().evictAll();
        workers.shutdownNow();
    }
}
