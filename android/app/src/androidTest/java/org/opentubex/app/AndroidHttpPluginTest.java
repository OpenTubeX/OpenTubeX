package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.plugin.util.CapacitorHttpUrlConnection;
import com.getcapacitor.plugin.util.HttpRequestHandler;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketAddress;
import java.net.URI;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.Test;

public class AndroidHttpPluginTest {
    private static final int TIMEOUT_MS = 15_000;

    @Test
    public void abortBeforeTheConnectionOpensClosesItOnceItDoes() throws Exception {
        AndroidHttpPlugin plugin = new AndroidHttpPlugin();
        ProxySelector original = ProxySelector.getDefault();
        List<Socket> accepted = new CopyOnWriteArrayList<>();
        try (ServerSocket server = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))) {
            // Accept the request and never answer it.
            Thread acceptor = new Thread(() -> {
                try {
                    while (true) accepted.add(server.accept());
                } catch (IOException closed) {
                    // The test finished
                }
            });
            acceptor.start();

            // Connecting asks the proxy selector for a route, so holding it
            // there places the abort before the connection opens.
            CountDownLatch connecting = new CountDownLatch(1);
            CountDownLatch aborted = new CountDownLatch(1);
            ProxySelector.setDefault(new ProxySelector() {
                @Override
                public List<Proxy> select(URI uri) {
                    if (uri.getPort() != server.getLocalPort()) return original.select(uri);
                    connecting.countDown();
                    try {
                        aborted.await(TIMEOUT_MS, TimeUnit.MILLISECONDS);
                    } catch (InterruptedException error) {
                        Thread.currentThread().interrupt();
                    }
                    return Collections.singletonList(Proxy.NO_PROXY);
                }

                @Override
                public void connectFailed(URI uri, SocketAddress address, IOException error) {}
            });

            JSObject options = new JSObject();
            options.put("requestId", "pending-connect");
            options.put("url", "http://127.0.0.1:" + server.getLocalPort() + "/youtubei/v1/browse");
            options.put("method", "POST");
            options.put("headers", new JSObject().put("User-Agent", "test").put("Content-Type", "application/json"));
            options.put("data", "{}");
            options.put("connectTimeout", TIMEOUT_MS);
            options.put("readTimeout", TIMEOUT_MS);
            CountDownLatch finished = new CountDownLatch(1);
            AtomicReference<String> outcome = new AtomicReference<>();
            plugin.request(new PluginCall(null, "AndroidHttp", "1", "request", options) {
                @Override
                public void resolve(JSObject data) {
                    outcome.set("resolved");
                    finished.countDown();
                }

                @Override
                public void reject(String msg, String code, Exception ex) {
                    outcome.set("rejected");
                    finished.countDown();
                }
            });

            assertTrue("Request never connected", connecting.await(5, TimeUnit.SECONDS));
            // OkHttp asks for the route while holding the connection pool
            // that disconnecting needs, so the abort must not wait for its
            // disconnect. Release the route once the disconnect waits for it.
            Thread aborting = new Thread(() -> abort(plugin));
            aborting.start();
            aborting.join(5000);
            assertEquals("Abort waited for the connection", Thread.State.TERMINATED, aborting.getState());
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (!isDisconnectBlocked()) {
                assertTrue("Abort never reached the connection", System.nanoTime() < deadline);
                Thread.yield();
            }
            aborted.countDown();

            assertTrue("Aborted request kept waiting for its response", finished.await(5, TimeUnit.SECONDS));
            assertEquals("rejected", outcome.get());
        } finally {
            ProxySelector.setDefault(original);
            for (Socket socket : accepted) socket.close();
            abort(plugin);
        }
    }

    @Test
    public void abortBeforeTheConnectionIsAttachedFailsTheRequest() throws Exception {
        List<Socket> accepted = new CopyOnWriteArrayList<>();
        try (ServerSocket server = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))) {
            Thread acceptor = new Thread(() -> {
                try {
                    while (true) {
                        Socket socket = server.accept();
                        accepted.add(socket);
                        OutputStream output = socket.getOutputStream();
                        output.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
                            .getBytes(StandardCharsets.US_ASCII));
                        output.flush();
                    }
                } catch (IOException closed) {
                    // The test finished
                }
            });
            acceptor.start();

            JSObject data = new JSObject();
            data.put("url", "http://127.0.0.1:" + server.getLocalPort() + "/youtubei/v1/browse");
            data.put("method", "GET");
            data.put("headers", new JSObject().put("User-Agent", "test"));
            AndroidHttpPlugin.RequestOptions options = new AndroidHttpPlugin.RequestOptions(data);
            // The abort arrives after the worker checked for one, before
            // HttpRequestHandler attaches the connection it then opens.
            options.abort();
            PluginCall request = new PluginCall(null, null, PluginCall.CALLBACK_ID_DANGLING, null, options);

            try {
                HttpRequestHandler.request(request, null, null);
                fail("Aborted request completed");
            } catch (RuntimeException expected) {
                // Rejected before connecting
            }
            assertEquals("Aborted request connected", 0, accepted.size());
        } finally {
            for (Socket socket : accepted) socket.close();
        }
    }

    @Test
    public void abortDuringTheRequestBodyConnectionClosesIt() throws Exception {
        AndroidHttpPlugin plugin = new AndroidHttpPlugin();
        List<Socket> accepted = new CopyOnWriteArrayList<>();
        CountDownLatch handshaking = new CountDownLatch(1);
        try (ServerSocket server = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))) {
            // Accept the connection and never answer its TLS handshake, which
            // Capacitor runs while opening the stream for the request body.
            Thread acceptor = new Thread(() -> {
                try {
                    while (true) {
                        accepted.add(server.accept());
                        handshaking.countDown();
                    }
                } catch (IOException closed) {
                    // The test finished
                }
            });
            acceptor.start();

            JSObject options = new JSObject();
            options.put("requestId", "pending-connect");
            options.put("url", "https://127.0.0.1:" + server.getLocalPort() + "/youtubei/v1/browse");
            options.put("method", "POST");
            options.put("headers", new JSObject().put("User-Agent", "test").put("Content-Type", "application/json"));
            options.put("data", "{}");
            options.put("connectTimeout", TIMEOUT_MS);
            options.put("readTimeout", TIMEOUT_MS);
            CountDownLatch finished = new CountDownLatch(1);
            AtomicReference<String> outcome = new AtomicReference<>();
            plugin.request(new PluginCall(null, "AndroidHttp", "1", "request", options) {
                @Override
                public void resolve(JSObject data) {
                    outcome.set("resolved");
                    finished.countDown();
                }

                @Override
                public void reject(String msg, String code, Exception ex) {
                    outcome.set("rejected");
                    finished.countDown();
                }
            });

            assertTrue("Request never connected", handshaking.await(5, TimeUnit.SECONDS));
            abort(plugin);

            assertTrue("Aborted request kept waiting for its handshake", finished.await(5, TimeUnit.SECONDS));
            assertEquals("rejected", outcome.get());
        } finally {
            for (Socket socket : accepted) socket.close();
            abort(plugin);
        }
    }

    private static boolean isDisconnectBlocked() {
        for (Map.Entry<Thread, StackTraceElement[]> thread : Thread.getAllStackTraces().entrySet()) {
            if (thread.getKey().getState() != Thread.State.BLOCKED) continue;
            for (StackTraceElement frame : thread.getValue()) {
                if (frame.getClassName().equals(CapacitorHttpUrlConnection.class.getName()) && frame.getMethodName().equals("disconnect")) {
                    return true;
                }
            }
        }
        return false;
    }

    private static void abort(AndroidHttpPlugin plugin) {
        plugin.abort(new PluginCall(null, "AndroidHttp", "2", "abort", new JSObject().put("requestId", "pending-connect")) {
            @Override
            public void resolve() {}
        });
    }
}
