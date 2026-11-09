package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.ParcelFileDescriptor;
import android.util.Base64;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLSocketFactory;

import okhttp3.tls.HandshakeCertificates;
import okhttp3.tls.HeldCertificate;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PairingCameraTest {
    @Test
    public void pairingScannerCanOpenTheCameraInTheWebView() throws Exception {
        grantCamera();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            WebView view = webView(scenario);
            awaitValue(view, "location.protocol === 'https:' && document.readyState === 'complete'", "true");
            // The pairing scanner asks for the rear camera like this.
            evaluate(view,
                "window.pairingCameraResult = 'pending';" +
                "navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function(stream) {" +
                "  window.pairingCameraResult = stream.getVideoTracks().length > 0 ? 'opened' : 'no video';" +
                "  stream.getTracks().forEach(function(track) { track.stop(); });" +
                "}, function(error) { window.pairingCameraResult = error.name; });"
            );
            awaitValue(view, "window.pairingCameraResult", "\"opened\"");
        }
    }

    /**
     * Android WebView lists qr_code in BarcodeDetector.getSupportedFormats() but
     * never detects one, so the scanner must decode with qr-scanner's worker.
     * This shows the real scanner an invite for another server, which the app
     * can only reject after decoding and parsing it. Accepting an invite would
     * need X25519 in WebCrypto, which older WebViews lack.
     */
    @Test
    public void pairingScannerDecodesAnInviteQrCode() throws Exception {
        grantCamera();
        HeldCertificate certificate = new HeldCertificate.Builder()
            .addSubjectAlternativeName("127.0.0.1")
            .build();
        SSLSocketFactory originalSocketFactory = HttpsURLConnection.getDefaultSSLSocketFactory();
        // MockWebServer cannot serve HTTPS on Android 8, whose TLS sessions
        // report no requested server names, so serve the health check directly.
        try (ServerSocket server = new HandshakeCertificates.Builder().heldCertificate(certificate).build()
                .sslContext().getServerSocketFactory().createServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))) {
            serveHealthCheck(server);
            // Native HTTP uses HttpsURLConnection in this process, so trust the
            // test certificate there instead of in the app's configuration.
            HttpsURLConnection.setDefaultSSLSocketFactory(new HandshakeCertificates.Builder()
                .addTrustedCertificate(certificate.certificate())
                .build()
                .sslSocketFactory());

            String origin = "https://127.0.0.1:" + server.getLocalPort();
            String invite = "opentubex-pairing-invite:" + base64Url(("{\"version\":1" +
                ",\"origin\":\"https://other-server.invalid\"" +
                ",\"sessionId\":\"" + randomBase64Url(32) + "\"" +
                ",\"pairingSecret\":\"" + randomBase64Url(32) + "\"" +
                ",\"recipientToken\":\"" + randomBase64Url(32) + "\"" +
                ",\"accountId\":\"" + UUID.randomUUID() + "\"}").getBytes(StandardCharsets.UTF_8));

            try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
                WebView view = webView(scenario);
                // .app renders once the saved settings have loaded.
                awaitValue(view, "!!document.querySelector('.app')", "true", 60);
                // Startup marks the tutorial 'new' before .app renders, then shows it.
                awaitValue(view, "localStorage.getItem('opentubex.tutorial.audience') !== 'new' || " +
                    "!!document.querySelector('.tutorialActions button')", "true");
                evaluate(view, "document.querySelector('.tutorialActions button')?.click()");
                awaitValue(view, "!document.querySelector('.tutorialOverlay')", "true");
                // Point the app at the test server in memory only, so a device
                // signed in to another server keeps its saved account.
                evaluate(view, "(() => {" +
                    "  const app = document.querySelector('#app').__vue_app__.config.globalProperties;" +
                    "  const store = app.$store;" +
                    "  window.__pairingTest = {" +
                    "    store," +
                    "    saved: {" +
                    "      setSyncServerEnabled: store.getters.getSyncServerEnabled," +
                    "      setSyncServerUrl: store.getters.getSyncServerUrl," +
                    "      setSyncServerToken: store.getters.getSyncServerToken" +
                    "    }," +
                    "    t: key => app.$t(key)," +
                    "    button(key) {" +
                    "      return [...document.querySelectorAll('button')].find(button => button.textContent.trim() === this.t(key));" +
                    "    }" +
                    "  };" +
                    "  store.commit('setSyncServerToken', '');" +
                    "  store.commit('setSyncServerUrl', '" + origin + "');" +
                    "  store.commit('setSyncServerEnabled', true);" +
                    // The scanner replaces its video once it decodes a code.
                    "  document.addEventListener('loadeddata', event => {" +
                    "    if (event.target.matches('.scannerVideo')) window.__pairingTest.cameraShown = true;" +
                    "  }, true);" +
                    "})()");
                try {
                    showQrCodeToTheCamera(view, qrModules(invite));
                    evaluate(view, "__pairingTest.store.commit('setSettingsWindowSection', 'sync');" +
                        "__pairingTest.store.dispatch('showSettingsWindow')");
                    // The button is enabled once the server reports key pairing.
                    awaitValue(view, "__pairingTest.button('Settings.Sync Settings.Pair With Existing Device')?.disabled",
                        "false", 60);
                    evaluate(view, "__pairingTest.button('Settings.Sync Settings.Pair With Existing Device').click()");
                    awaitValue(view, "!!__pairingTest.button('Settings.Sync Settings.Use Pairing Invite')", "true");
                    evaluate(view, "__pairingTest.button('Settings.Sync Settings.Use Pairing Invite').click()");
                    awaitValue(view, "!__pairingTest.cameraShown ? 'camera not shown' : " +
                        "(error => !error ? 'still scanning' : " +
                        "error === __pairingTest.t('Settings.Sync Settings.Pairing Server Mismatch') ? 'rejected' : error)" +
                        "(document.querySelector('.pairingError')?.textContent.trim())", "\"rejected\"", 60);
                } finally {
                    // Do not wait, so a failure above stays the reported one.
                    InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(
                        "__pairingTest.store.dispatch('hideSettingsWindow');" +
                        "Object.entries(__pairingTest.saved).forEach(([mutation, value]) => " +
                        "__pairingTest.store.commit(mutation, value))", null));
                }
            }
        } finally {
            HttpsURLConnection.setDefaultSSLSocketFactory(originalSocketFactory);
        }
    }

    /** Answers /health with key pairing support and every other request with 404. */
    private static void serveHealthCheck(ServerSocket server) {
        new Thread(() -> {
            while (!server.isClosed()) {
                try {
                    Socket client = server.accept();
                    new Thread(() -> {
                        try (Socket connection = client) {
                            BufferedReader request = new BufferedReader(
                                new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8));
                            String requestLine = request.readLine();
                            for (String header = requestLine; header != null && !header.isEmpty(); ) header = request.readLine();
                            boolean health = requestLine != null && requestLine.startsWith("GET /health ");
                            byte[] body = (health
                                ? "{\"capabilities\":{\"encrypted_sync\":1,\"live_sync\":1,\"key_pairing\":1}}"
                                : "{}").getBytes(StandardCharsets.UTF_8);
                            OutputStream response = connection.getOutputStream();
                            response.write(("HTTP/1.1 " + (health ? "200 OK" : "404 Not Found") + "\r\n" +
                                "Content-Type: application/json\r\nContent-Length: " + body.length +
                                "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                            response.write(body);
                            response.flush();
                        } catch (IOException ignored) {
                            // The app gave up on this request.
                        }
                    }).start();
                } catch (IOException closed) {
                    // The test finished.
                }
            }
        }).start();
    }

    /** Replaces the camera with a canvas stream that shows the given QR code. */
    private static void showQrCodeToTheCamera(WebView view, String modules) throws Exception {
        evaluate(view, "(() => {" +
            "  const rows = " + modules + ";" +
            "  const canvas = document.createElement('canvas');" +
            "  canvas.width = canvas.height = 480;" +
            "  const context = canvas.getContext('2d');" +
            // Keep the code and its quiet zone inside qr-scanner's central scan region.
            "  const scale = Math.floor(300 / (rows.length + 8));" +
            "  const offset = Math.floor((canvas.width - rows.length * scale) / 2);" +
            "  context.fillStyle = '#fff';" +
            "  context.fillRect(0, 0, canvas.width, canvas.height);" +
            "  context.fillStyle = '#000';" +
            "  rows.forEach((row, y) => [...row].forEach((module, x) => {" +
            "    if (module === '1') context.fillRect(offset + x * scale, offset + y * scale, scale, scale);" +
            "  }));" +
            // A canvas stream only sends a frame after the canvas changes, so
            // flip one corner pixel outside the code a few times a second.
            "  let frame = 0;" +
            "  setInterval(() => {" +
            "    context.fillStyle = frame++ % 2 ? '#fff' : '#fefefe';" +
            "    context.fillRect(0, 0, 1, 1);" +
            "  }, 200);" +
            "  navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(5);" +
            "})()");
    }

    private static String qrModules(String text) throws Exception {
        Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
        hints.put(EncodeHintType.MARGIN, 0);
        BitMatrix matrix = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints);
        StringBuilder rows = new StringBuilder("[");
        for (int y = 0; y < matrix.getHeight(); y++) {
            rows.append(y == 0 ? "'" : ",'");
            for (int x = 0; x < matrix.getWidth(); x++) rows.append(matrix.get(x, y) ? '1' : '0');
            rows.append('\'');
        }
        return rows.append(']').toString();
    }

    private static String randomBase64Url(int length) {
        byte[] bytes = new byte[length];
        new SecureRandom().nextBytes(bytes);
        return base64Url(bytes);
    }

    private static String base64Url(byte[] bytes) {
        return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    private static void grantCamera() throws Exception {
        String packageName = InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName();
        try (ParcelFileDescriptor.AutoCloseInputStream output = new ParcelFileDescriptor.AutoCloseInputStream(
                InstrumentationRegistry.getInstrumentation().getUiAutomation()
                    .executeShellCommand("pm grant " + packageName + " " + Manifest.permission.CAMERA))) {
            while (output.read() != -1) {}
        }
        assertEquals("Android must be able to grant camera access for pairing", PackageManager.PERMISSION_GRANTED,
            InstrumentationRegistry.getInstrumentation().getTargetContext().checkSelfPermission(Manifest.permission.CAMERA));
    }

    private static WebView webView(ActivityScenario<MainActivity> scenario) {
        AtomicReference<WebView> view = new AtomicReference<>();
        scenario.onActivity(activity -> view.set(activity.getBridge().getWebView()));
        return view.get();
    }

    private static void awaitValue(WebView view, String script, String expected) throws Exception {
        awaitValue(view, script, expected, 15);
    }

    private static void awaitValue(WebView view, String script, String expected, int seconds) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
        String actual;
        do {
            actual = evaluate(view, script);
            if (expected.equals(actual)) return;
            Thread.sleep(100);
        } while (System.nanoTime() < deadline);
        assertEquals(script, expected, actual);
    }

    private static String evaluate(WebView view, String script) throws Exception {
        CountDownLatch evaluated = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            view.evaluateJavascript(script, value -> {
                result.set(value);
                evaluated.countDown();
            })
        );
        // Rendering on a busy software-GPU emulator can hold the UI thread for several seconds.
        assertTrue("WebView responds", evaluated.await(15, TimeUnit.SECONDS));
        return result.get();
    }
}
