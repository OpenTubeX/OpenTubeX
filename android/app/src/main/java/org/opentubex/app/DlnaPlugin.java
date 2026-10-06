package org.opentubex.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiManager;
import android.os.SystemClock;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

@CapacitorPlugin(name = "Dlna")
public final class DlnaPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService discoveryWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService requestWorker = Executors.newFixedThreadPool(4);
    private final Set<String> addresses = ConcurrentHashMap.newKeySet();
    private DlnaMediaServer relay;
    private volatile boolean destroyed;
    private volatile DatagramSocket discoverySocket;

    private Network wifiNetwork() {
        ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
                !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return network;
        }
        return null;
    }

    @PluginMethod public void discover(PluginCall call) {
        if (destroyed) { call.reject("DLNA plugin closed"); return; }
        discoveryWorker.execute(() -> {
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiManager.MulticastLock lock = wifi.createMulticastLock("OpenTubeX DLNA discovery");
            lock.setReferenceCounted(false);
            try (DatagramSocket socket = new DatagramSocket()) {
                discoverySocket = socket;
                if (destroyed) throw new IOException("DLNA plugin closed");
                Network network = wifiNetwork();
                if (network != null) network.bindSocket(socket);
                lock.acquire();
                socket.setSoTimeout(250);
                byte[] message = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\n" +
                    "MAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n")
                    .getBytes(StandardCharsets.US_ASCII);
                socket.send(new DatagramPacket(message, message.length, InetAddress.getByName("239.255.255.250"), 1900));
                JSArray responses = new JSArray();
                long deadline = SystemClock.elapsedRealtime() + 2500;
                while (!destroyed && SystemClock.elapsedRealtime() < deadline && responses.length() < 64) {
                    DatagramPacket packet = new DatagramPacket(new byte[8192], 8192);
                    try { socket.receive(packet); } catch (SocketTimeoutException ignored) { continue; }
                    String address = packet.getAddress().getHostAddress();
                    addresses.add(address);
                    responses.put(new JSObject().put("address", address).put("message",
                        new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8)));
                }
                call.resolve(new JSObject().put("responses", responses));
            } catch (Exception error) { call.reject("Unable to discover DLNA devices", error); }
            finally {
                discoverySocket = null;
                if (lock.isHeld()) lock.release();
            }
        });
    }

    @PluginMethod public void request(PluginCall call) {
        HttpUrl url = HttpUrl.parse(call.getString("url", ""));
        String method = call.getString("method", "GET");
        String body = call.getString("body", "");
        if (destroyed || url == null || url.isHttps() || !addresses.contains(url.host()) ||
            !url.username().isEmpty() || !url.password().isEmpty() ||
            !(method.equals("GET") || method.equals("POST")) || body.length() > 256_000) {
            call.reject("Invalid DLNA request");
            return;
        }
        requestWorker.execute(() -> {
            // LAN control stays on Wi-Fi even when an Internet proxy or VPN is enabled.
            OkHttpClient.Builder builder = new OkHttpClient.Builder().proxy(Proxy.NO_PROXY)
                .followRedirects(false).followSslRedirects(false)
                .connectTimeout(3, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS)
                .callTimeout(8, TimeUnit.SECONDS);
            Network network = wifiNetwork();
            if (network != null) builder.socketFactory(network.getSocketFactory());
            OkHttpClient client = builder.build();
            try {
                Request.Builder request = new Request.Builder().url(url).method(method,
                    method.equals("GET") ? null : RequestBody.create(body, null));
                JSObject headers = call.getObject("headers", new JSObject());
                for (String name : new String[]{"Content-Type", "SOAPACTION"}) {
                    String value = headers.getString(name);
                    if (value != null) request.header(name, value);
                }
                try (Response response = client.newCall(request.build()).execute()) {
                    String result = response.peekBody(256_001).string();
                    if (result.length() > 256_000) throw new IOException("DLNA response too large");
                    call.resolve(new JSObject().put("status", response.code()).put("body", result));
                }
            } catch (Exception error) { call.reject("DLNA request failed: " + error.getMessage(), error); }
            finally { client.connectionPool().evictAll(); }
        });
    }

    @PluginMethod public void startMediaServer(PluginCall call) {
        worker.execute(() -> {
            HttpUrl url = HttpUrl.parse(call.getString("mediaUrl", ""));
            String audioRaw = call.getString("audioUrl");
            HttpUrl audio = audioRaw == null ? null : HttpUrl.parse(audioRaw);
            String address = call.getString("address", "");
            if ((audioRaw != null && (audio == null || !audio.username().isEmpty() || !audio.password().isEmpty())) || destroyed || relay != null || url == null || !addresses.contains(address) ||
                !url.username().isEmpty() || !url.password().isEmpty()) {
                call.reject("Invalid DLNA media or cast already active");
                return;
            }
            try (DatagramSocket route = new DatagramSocket()) {
                Network network = wifiNetwork();
                if (network != null) network.bindSocket(route);
                route.connect(InetAddress.getByName(address), 1900);
                relay = new DlnaMediaServer(getContext(), url, audio, address, route.getLocalAddress(), call.getDouble("startSeconds", 0.0));
                call.resolve(new JSObject().put("castId", relay.castId).put("mediaUrl", relay.mediaUrl()));
            } catch (Exception error) { call.reject("Unable to start DLNA media relay", error); }
        });
    }

    @PluginMethod public void hasFailed(PluginCall call) {
        worker.execute(() -> call.resolve(new JSObject().put("failed", relay != null &&
            relay.castId.equals(call.getString("castId")) && relay.muxFailed)));
    }

    @PluginMethod public void stopMediaServer(PluginCall call) {
        worker.execute(() -> {
            if (relay != null && relay.castId.equals(call.getString("castId"))) {
                relay.close();
                relay = null;
            }
            call.resolve();
        });
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        DatagramSocket socket = discoverySocket;
        if (socket != null) socket.close();
        discoveryWorker.shutdownNow();
        requestWorker.shutdownNow();
        worker.execute(() -> { if (relay != null) { relay.close(); relay = null; } });
        worker.shutdown();
        super.handleOnDestroy();
    }
}
