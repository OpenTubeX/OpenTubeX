package org.opentubex.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.media.MediaMetadataRetriever;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import okhttp3.HttpUrl;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.Arrays;
import java.util.List;

@RunWith(AndroidJUnit4.class)
public class DlnaCastingTest {
    @Test public void nativeDiscoveryControlAndRangedMediaWorkThroughTheBridge() throws Exception {
        verifyCastMenu(false);
    }

    @Test public void castsMergedTracksThroughTheWatchMenu() throws Exception {
        verifyCastMenu(true);
    }

    private void verifyCastMenu(boolean merged) throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        InetAddress local = null;
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities == null || !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue;
            for (LinkAddress link : manager.getLinkProperties(network).getLinkAddresses()) {
                if (local == null && link.getAddress() instanceof Inet4Address) local = link.getAddress();
            }
        }
        assertNotNull("Wi-Fi IPv4 address", local);
        String host = local.getHostAddress();
        byte[] video;
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("hls-1080.mp4")) {
            video = readBody(input);
        }
        byte[] audio;
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("post-live-audio.m4a.b64")) {
            audio = java.util.Base64.getMimeDecoder().decode(readBody(input));
        }
        List<String> actions = new CopyOnWriteArrayList<>();
        AtomicReference<String> castUri = new AtomicReference<>();
        AtomicReference<byte[]> receivedVideo = new AtomicReference<>();
        AtomicReference<Throwable> rendererError = new AtomicReference<>();
        CountDownLatch descriptionsStarted = new CountDownLatch(2);
        ExecutorService clients = Executors.newCachedThreadPool();
        try (ServerSocket fixture = new ServerSocket(0, 8, local);
             MulticastSocket ssdp = new MulticastSocket(1900);
             DatagramSocket replies = new DatagramSocket(0, local);
             ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ssdp.joinGroup(new InetSocketAddress("239.255.255.250", 1900), NetworkInterface.getByInetAddress(local));
            String descriptionUrl = "http://" + host + ":" + fixture.getLocalPort() + "/otx-dlna-test.xml";
            Thread responder = new Thread(() -> {
                try {
                    while (!ssdp.isClosed()) {
                        DatagramPacket packet = new DatagramPacket(new byte[8192], 8192);
                        ssdp.receive(packet);
                        if (!new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8).contains("M-SEARCH")) continue;
                        byte[] response = ("HTTP/1.1 200 OK\r\nLOCATION: " + descriptionUrl + "\r\n\r\n")
                            .getBytes(StandardCharsets.US_ASCII);
                        replies.send(new DatagramPacket(response, response.length, packet.getAddress(), packet.getPort()));
                    }
                } catch (IOException ignored) {}
            });
            responder.start();
            Thread server = new Thread(() -> {
                try {
                    while (!fixture.isClosed()) {
                        Socket incoming = fixture.accept();
                        clients.execute(() -> {
                          try (Socket socket = incoming) {
                            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                            String request = reader.readLine();
                            boolean range = false;
                            int contentLength = 0;
                            String action = null;
                            for (String line; (line = reader.readLine()) != null && !line.isEmpty();) {
                                if (line.equalsIgnoreCase("Range: bytes=2-5")) range = true;
                                if (line.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:")) contentLength = Integer.parseInt(line.substring(15).trim());
                                if (line.toLowerCase(java.util.Locale.ROOT).startsWith("soapaction:")) action = line.substring(line.indexOf('#') + 1).replace("\"", "").trim();
                            }
                            char[] payload = new char[contentLength];
                            for (int offset = 0; offset < payload.length;) {
                                int count = reader.read(payload, offset, payload.length - offset);
                                if (count < 0) throw new EOFException();
                                offset += count;
                            }
                            if (request.startsWith("POST ")) {
                                actions.add(action);
                                if ("SetAVTransportURI".equals(action)) {
                                    castUri.set(new String(payload).split("<CurrentURI>")[1].split("</CurrentURI>")[0].replace("&amp;", "&"));
                                } else if ("Play".equals(action) && castUri.get() != null) {
                                    HttpURLConnection stream = (HttpURLConnection) new URL(castUri.get()).openConnection(Proxy.NO_PROXY);
                                    try {
                                        stream.setConnectTimeout(5000);
                                        stream.setReadTimeout(5000);
                                        stream.setRequestProperty("Range", "bytes=0-");
                                        assertEquals(200, stream.getResponseCode());
                                        receivedVideo.set(readBody(stream.getInputStream()));
                                    } finally { stream.disconnect(); }
                                }
                            }
                            if (request.contains("/otx-dlna-concurrent-")) {
                                descriptionsStarted.countDown();
                                if (!descriptionsStarted.await(3, TimeUnit.SECONDS)) {
                                    rendererError.compareAndSet(null, new AssertionError("DLNA device description requests ran serially"));
                                }
                            }
                            String body = request.contains("/otx-dlna-")
                                ? "<root><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>Android test TV</friendlyName><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/control</controlURL></service></serviceList></device></root>"
                                : "GetPositionInfo".equals(action) ? "<GetPositionInfoResponse><RelTime>00:00:08</RelTime></GetPositionInfoResponse>" : request.startsWith("POST ") ? "<ok/>" : range ? "cdef" : "abcdefghij";
                            byte[] bytes = request.contains("/audio.m4a") ? audio : request.contains("/real.mp4") ? video : body.getBytes(StandardCharsets.US_ASCII);
                            String headers = "HTTP/1.1 " + (range ? "206 Partial Content" : "200 OK") +
                                "\r\nContent-Length: " + bytes.length + "\r\nContent-Type: " + (request.contains("/real.mp4") ? "video/mp4" : "text/xml") + "\r\nAccess-Control-Allow-Origin: *\r\n" +
                                (range ? "Content-Range: bytes 2-5/10\r\nAccept-Ranges: bytes\r\n" : "") +
                                "Connection: close\r\n\r\n";
                            socket.getOutputStream().write(headers.getBytes(StandardCharsets.US_ASCII));
                            if (!request.startsWith("HEAD ")) socket.getOutputStream().write(bytes);
                          } catch (Throwable error) { rendererError.set(error); }
                        });
                    }
                } catch (IOException ignored) {}
            });
            server.start();
            AtomicReference<WebView> view = new AtomicReference<>();
            scenario.onActivity(activity -> view.set(activity.getBridge().getWebView()));
            WebView webView = view.get();
            await(webView, "!!document.querySelector('.app')");
            evaluate(webView, """
                window.__dlnaSetting = false;
                window.dlnaMessages = [];
                for (const level of ['warn', 'error']) {
                    const original = console[level];
                    console[level] = (...args) => { dlnaMessages.push(args.map(String).join(' ')); original(...args); };
                }
                (async () => {
                    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                    store.commit('setSettingsWindowSection', 'player');
                    await store.dispatch('showSettingsWindow');
                    window.__dlnaSetting = true;
                })();
                """);
            await(webView, "window.__dlnaSetting && Array.from(document.querySelectorAll('.settingsWindow label')).some(label => label.textContent.includes('Show DLNA Cast Button'))");
            evaluate(webView, "document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('hideSettingsWindow');true");
            evaluate(webView, String.format(java.util.Locale.ROOT, """
                window.__dlnaTest = null;
                (async () => {
                    const native = (method, options = {}) => window.Capacitor.nativePromise('Dlna', method, options);
                    try {
                        const discovery = await native('discover');
                        const device = discovery.responses.find(item => item.message.includes('/otx-dlna-test.xml'));
                        if (!device) throw new Error('Fixture not discovered: ' + JSON.stringify(discovery));
                        const description = await native('request', {url: '%s'});
                        const controlUrl = 'http://%s:%d/control';
                        const control = await native('request', {url: controlUrl,method:'POST',body:'<Play/>',headers:{SOAPACTION:'"urn:schemas-upnp-org:service:AVTransport:1#Play"'}});
                        const position = await native('request', {url:controlUrl,method:'POST',body:'<GetPositionInfo/>',headers:{SOAPACTION:'"urn:schemas-upnp-org:service:AVTransport:1#GetPositionInfo"'}});
                        const relay = await native('startMediaServer', {address:device.address, mediaUrl:'http://%s:%d/video.mp4'});
                        let rejected = false;
                        try { await native('startMediaServer', {address:device.address, mediaUrl:'http://%s:%d/video.mp4'}); }
                        catch { rejected = true; }
                        window.__dlnaTest = {description, control, position, relay, rejected};
                    } catch (error) { window.__dlnaTest = {error:String(error)}; }
                })();
                """, descriptionUrl, host, fixture.getLocalPort(), host, fixture.getLocalPort(), host, fixture.getLocalPort()));
            await(webView, "window.__dlnaTest !== null");
            JSONObject result = new JSONObject(evaluate(webView, "window.__dlnaTest"));
            assertFalse(result.toString(), result.has("error"));
            assertTrue(result.getJSONObject("description").getString("body").contains("Android test TV"));
            assertEquals(200, result.getJSONObject("control").getInt("status"));
            assertTrue(result.getJSONObject("position").getString("body").contains("<RelTime>00:00:08</RelTime>"));
            assertTrue(result.getBoolean("rejected"));
            evaluate(webView, String.format(java.util.Locale.ROOT, """
                window.__dlnaConcurrent = null;
                Promise.all([1, 2].map(index => window.Capacitor.nativePromise('Dlna', 'request', {
                    url: 'http://%s:%d/otx-dlna-concurrent-' + index + '.xml'
                }))).then(results => window.__dlnaConcurrent = results.map(result => result.status))
                  .catch(error => window.__dlnaConcurrent = {error: String(error)}); true;
                """, host, fixture.getLocalPort()));
            await(webView, "window.__dlnaConcurrent !== null");
            assertEquals("[200,200]", evaluate(webView, "window.__dlnaConcurrent"));
            assertNull("Device descriptions must load concurrently", rendererError.get());
            JSONObject relay = result.getJSONObject("relay");
            String media = relay.getString("mediaUrl");
            HttpURLConnection request = (HttpURLConnection) new URL(media).openConnection(Proxy.NO_PROXY);
            try {
                request.setRequestProperty("Range", "bytes=2-5");
                assertEquals(206, request.getResponseCode());
                assertEquals("bytes 2-5/10", request.getHeaderField("Content-Range"));
                assertEquals("cdef", new String(readBody(request.getInputStream()), StandardCharsets.US_ASCII));
            } finally { request.disconnect(); }
            HttpURLConnection head = (HttpURLConnection) new URL(media).openConnection(Proxy.NO_PROXY);
            try {
                head.setRequestMethod("HEAD");
                assertEquals(200, head.getResponseCode());
                assertEquals("10", head.getHeaderField("Content-Length"));
                assertEquals(0, readBody(head.getInputStream()).length);
            } finally { head.disconnect(); }
            HttpURLConnection denied = (HttpURLConnection) new URL(media.replace(relay.getString("castId"), "wrong-token")).openConnection(Proxy.NO_PROXY);
            try { assertEquals(404, denied.getResponseCode()); } finally { denied.disconnect(); }
            evaluate(webView, "window.__dlnaDiscoveryFinished=false;window.Capacitor.nativePromise('Dlna','discover',{}).finally(()=>window.__dlnaDiscoveryFinished=true);window.__dlnaStopped=false;window.Capacitor.nativePromise('Dlna','stopMediaServer',{castId:'" + relay.getString("castId") + "'}).then(()=>{window.__dlnaStopBlocked=window.__dlnaDiscoveryFinished;window.__dlnaStopped=true})");
            await(webView, "window.__dlnaStopped");
            assertEquals("Stop must not wait for rediscovery", "false", evaluate(webView, "window.__dlnaStopBlocked"));
            await(webView, "window.__dlnaDiscoveryFinished");
            HttpURLConnection stopped = (HttpURLConnection) new URL(media).openConnection(Proxy.NO_PROXY);
            stopped.setConnectTimeout(1000);
            try { stopped.getResponseCode(); fail("Stopped relay still listening"); }
            catch (IOException expected) {} finally { stopped.disconnect(); }

            // Supply a local video to the normal Watch view, then use its real cast menu.
            actions.clear();
            org.json.JSONArray formats = new org.json.JSONArray();
            if (merged) {
                formats.put(new JSONObject().put("url", "http://" + host + ":" + fixture.getLocalPort() + "/real.mp4")
                    .put("format_id", "299").put("protocol", "http").put("ext", "mp4").put("vcodec", "avc1.640028").put("acodec", "none").put("height", 1080));
                formats.put(new JSONObject().put("url", "http://" + host + ":" + fixture.getLocalPort() + "/audio.m4a")
                    .put("format_id", "140").put("protocol", "http").put("ext", "m4a").put("vcodec", "none").put("acodec", "mp4a.40.2"));
            }
            evaluate(webView, "window.dlnaExtractionFormats=" + formats + ";window.dlnaMergedUi=" + merged + ";true");
            evaluate(webView, """
                window.testStore = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                window.testRouter = document.querySelector('#app').__vue_app__.config.globalProperties.$router;
                window.originalCastSetting = testStore.getters.getShowDlnaCastButton;
                window.findWatch = vnode => {
                    if (vnode?.component?.type?.name === 'Watch') return vnode.component.proxy;
                    const inner = vnode?.component?.subTree && findWatch(vnode.component.subTree);
                    if (inner) return inner;
                    for (const child of Array.isArray(vnode?.children) ? vnode.children : []) {
                        const found = findWatch(child); if (found) return found;
                    }
                };
                window.dlnaOriginalNativePromise = window.Capacitor.nativePromise;
                window.Capacitor.nativePromise = function(plugin, method, options) {
                    if (plugin === 'YtDlp' && method === 'extract' && options.args?.some(arg => arg.includes('DlnaTest001'))) {
                        return Promise.resolve({stdout: JSON.stringify({id:'DlnaTest001', formats:window.dlnaExtractionFormats, is_live:false})});
                    }
                    return dlnaOriginalNativePromise.call(this, plugin, method, options);
                };
                testRouter.push('/watch/DlnaTest001'); true;
                """);
            await(webView, "!!findWatch(document.querySelector('#app').__vue_app__._container._vnode)");
            try {
                evaluate(webView, String.format(java.util.Locale.ROOT, """
                    window.watchFixture = findWatch(document.querySelector('#app').__vue_app__._container._vnode);
                    watchFixture.videoLoadGeneration++;
                    window.dlnaLocalUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob('%s'), char=>char.charCodeAt(0))], {type:'video/mp4'}));
                    Object.assign(watchFixture, {isLoading:false, ytDlpStreamsPending:false, errorMessage:null,
                        isUpcoming:false, videoTitle:'Local DLNA MP4', videoLengthSeconds:2, activeFormat:'legacy',
                        legacyFormats:[{itag:18,url:dlnaLocalUrl,mimeType:'video/mp4',width:1920,height:dlnaMergedUi?360:1080,qualityLabel:'1080p'}]});
                    testStore.dispatch('updateShowDlnaCastButton', true); true;
                    """, java.util.Base64.getEncoder().encodeToString(video)));
                await(webView, "!!document.querySelector('.dlnaCastControl button') && !!document.querySelector('video') && watchFixture.$refs.player?.hasLoaded");
                // Local playback uses the same bytes without WebView HTTP restrictions;
                // casting reads the actual HTTP source through the native relay.
                evaluate(webView, String.format(java.util.Locale.ROOT, "watchFixture.legacyFormats=watchFixture.legacyFormats.map(format=>({...format,url:'http://%s:%d/real.mp4'}));true", host, fixture.getLocalPort()));
                evaluate(webView, "document.querySelector('video').loop=true;document.querySelector('video').play();document.querySelector('.dlnaCastControl button').click();true");
                await(webView, "Array.from(document.querySelectorAll('[role=option]')).some(option=>option.textContent.trim()==='Android test TV')");
                evaluate(webView, "document.querySelector('video').currentTime=dlnaMergedUi?0:0.5;Array.from(document.querySelectorAll('[role=option]')).find(option=>option.textContent.trim()==='Android test TV').click();true");
                await(webView, "document.querySelector('.dlnaCastControl button')?.getAttribute('aria-pressed')==='true'");
                assertNull("Local renderer failed", rendererError.get());
                if (!merged) assertArrayEquals("Renderer received the complete MP4 through the phone relay", video, receivedVideo.get());
                assertEquals(merged ? Arrays.asList("SetAVTransportURI", "Play") : Arrays.asList("SetAVTransportURI", "Play", "Seek"), actions);
                assertEquals("true", evaluate(webView, "document.querySelector('video').paused"));
                File received = File.createTempFile("dlna-received-", ".mp4", context.getCacheDir());
                try {
                    try (OutputStream output = new FileOutputStream(received)) { output.write(receivedVideo.get()); }
                    if (merged) {
                        MediaExtractor extractor = new MediaExtractor();
                        try { extractor.setDataSource(received.getAbsolutePath()); assertEquals(2, extractor.getTrackCount()); }
                        finally { extractor.release(); }
                    }
                    MediaMetadataRetriever decoder = new MediaMetadataRetriever();
                    try {
                        decoder.setDataSource(received.getAbsolutePath());
                        assertNotNull("Received MP4 decodes to a video frame", decoder.getFrameAtTime());
                    } finally { decoder.release(); }
                } finally { received.delete(); }
                evaluate(webView, "document.querySelector('.dlnaCastControl button').click();true");
                await(webView, "Array.from(document.querySelectorAll('[role=option]')).some(option=>option.textContent.trim()==='Stop casting')");
                evaluate(webView, "Array.from(document.querySelectorAll('[role=option]')).find(option=>option.textContent.trim()==='Stop casting').click();true");
                await(webView, "document.querySelector('.dlnaCastControl button')?.getAttribute('aria-pressed')==='false' && !document.querySelector('video').paused");
                assertEquals("Stop", actions.get(actions.size() - 1));
                HttpURLConnection finished = (HttpURLConnection) new URL(castUri.get()).openConnection(Proxy.NO_PROXY);
                finished.setConnectTimeout(1000);
                try { finished.getResponseCode(); fail("Cast relay still listening after Stop casting"); }
                catch (IOException expected) {} finally { finished.disconnect(); }
                System.out.println("DLNA UI " + (merged ? "streaming merge" : "complete MP4") + ": discovered renderer, Play/Stop, received " + receivedVideo.get().length + " MP4 bytes, decoded frame, resumed local playback, closed relay");
            } finally {
                evaluate(webView, "document.querySelector('video')?.pause();testRouter.push('/subscriptions');testStore.dispatch('updateShowDlnaCastButton', originalCastSetting);URL.revokeObjectURL(window.dlnaLocalUrl);window.Capacitor.nativePromise=dlnaOriginalNativePromise;true");
            }
        } finally {
            clients.shutdownNow();
        }
    }

    @Test public void reportsFailedMergeForCompleteSourceRecovery() throws Exception {
        verifyMergedRelay(true);
    }

    @Test public void mergesSeparateTracksWithoutPreparingACompleteFile() throws Exception {
        verifyMergedRelay(false);
    }

    private void verifyMergedRelay(boolean invalid) throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        byte[] video;
        byte[] audio;
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("hls-1080.mp4")) {
            video = readBody(input);
        }
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("post-live-audio.m4a.b64")) {
            audio = java.util.Base64.getMimeDecoder().decode(readBody(input));
        }
        ExecutorService clients = Executors.newCachedThreadPool();
        try (ServerSocket source = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))) {
            Thread listener = new Thread(() -> {
                while (!source.isClosed()) {
                    try {
                        Socket incoming = source.accept();
                        clients.execute(() -> {
                            try (Socket socket = incoming) {
                                BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                                String first = reader.readLine();
                                for (String line; (line = reader.readLine()) != null && !line.isEmpty();) {}
                                byte[] bytes = invalid ? new byte[]{0} : first.contains("/audio") ? audio : video;
                                socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                                if (!first.startsWith("HEAD")) socket.getOutputStream().write(bytes);
                            } catch (IOException ignored) {}
                        });
                    } catch (IOException ignored) {}
                }
            });
            listener.start();
            String base = "http://127.0.0.1:" + source.getLocalPort();
            HttpUrl videoUrl = HttpUrl.get(base + "/video");
            HttpUrl audioUrl = HttpUrl.get(base + "/audio");
            String liveSources = InstrumentationRegistry.getArguments().getString("youtubeSources");
            if (liveSources != null) {
                JSONObject metadata;
                try (InputStream input = new FileInputStream(liveSources)) {
                    metadata = new JSONObject(new String(readBody(input), StandardCharsets.UTF_8));
                }
                ExternalStreamRequestRegistry.shared().register(metadata.getJSONArray("formats"), "");
                videoUrl = HttpUrl.get(metadata.getString("videoUrl"));
                audioUrl = HttpUrl.get(metadata.getString("audioUrl"));

            }
            try (DlnaMediaServer relay = new DlnaMediaServer(context, videoUrl, audioUrl, "127.0.0.1", InetAddress.getByName("127.0.0.1"), 0)) {
                HttpURLConnection range = (HttpURLConnection) new URL(relay.mediaUrl()).openConnection(Proxy.NO_PROXY);
                try {
                    range.setRequestProperty("Range", "bytes=100-");
                    assertEquals(416, range.getResponseCode());
                } finally { range.disconnect(); }
                HttpURLConnection request = (HttpURLConnection) new URL(relay.mediaUrl()).openConnection(Proxy.NO_PROXY);
                request.setConnectTimeout(5000);
                request.setReadTimeout(30000);
                File received = File.createTempFile("dlna-merged-", ".mp4", context.getCacheDir());
                long started = System.nanoTime();
                try {
                    if (invalid) {
                        assertEquals(502, request.getResponseCode());
                        assertTrue("Failed merge is exposed for renderer recovery", relay.muxFailed);
                        return;
                    }
                    assertEquals(200, request.getResponseCode());
                    assertEquals("none", request.getHeaderField("Accept-Ranges"));
                    long firstBytesMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
                    int total = 0;
                    try (InputStream input = request.getInputStream(); OutputStream output = new FileOutputStream(received)) {
                        byte[] bytes = new byte[32 * 1024];
                        for (int count; (count = input.read(bytes)) != -1;) {
                            output.write(bytes, 0, count); total += count;
                            if (liveSources != null && total >= 2 * 1024 * 1024) break;
                        }
                    }
                    MediaExtractor extractor = new MediaExtractor();
                    try {
                        extractor.setDataSource(received.getAbsolutePath());
                        assertEquals(2, extractor.getTrackCount());
                        java.util.Set<String> types = new java.util.HashSet<>();
                        for (int track = 0; track < extractor.getTrackCount(); track++) types.add(extractor.getTrackFormat(track).getString(MediaFormat.KEY_MIME));
                        assertTrue(types.toString(), types.contains("video/avc"));
                        assertTrue(types.toString(), types.contains("audio/mp4a-latm"));
                    } finally { extractor.release(); }
                    MediaMetadataRetriever decoder = new MediaMetadataRetriever();
                    try {
                        decoder.setDataSource(received.getAbsolutePath());
                        assertNotNull("Merged video frame decodes", decoder.getFrameAtTime());
                        assertEquals("1080", decoder.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
                    } finally { decoder.release(); }
                    System.out.println("DLNA merged " + (liveSources == null ? "fixture" : "live YouTube 1080p60") + ": H.264 + AAC, first bytes in " + firstBytesMs + "ms, decoded frame from " + total + " bytes");
                } finally { request.disconnect(); received.delete(); }
            }
        } finally { clients.shutdownNow(); }
    }

    private static byte[] readBody(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        for (int count; (count = input.read(buffer)) != -1;) output.write(buffer, 0, count);
        return output.toByteArray();
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value); done.countDown();
        }));
        assertTrue("WebView evaluation timed out", done.await(5, TimeUnit.SECONDS));
        return result.get();
    }
    private static void await(WebView view, String condition) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        while (System.nanoTime() < deadline) {
            if ("true".equals(evaluate(view, condition))) return;
            Thread.sleep(100);
        }
        fail("Timed out: " + condition + "\n" + evaluate(view, "JSON.stringify({messages:window.dlnaMessages,watch:window.watchFixture && {loading:watchFixture.isLoading,pending:watchFixture.ytDlpStreamsPending,error:watchFixture.errorMessage,formats:watchFixture.legacyFormats,ready:watchFixture.playerReady,loaded:watchFixture.$refs.player?.hasLoaded},video:document.querySelector('video') && {ready:document.querySelector('video').readyState,error:document.querySelector('video').error,src:document.querySelector('video').currentSrc},castButton:!!document.querySelector('.dlnaCastControl button')})"));
    }
}
