package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.os.SystemClock;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NativeHttpCookiesTest {
    @Test public void nativeRequestsDoNotShareWebViewCookies() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class);
             ServerSocket server = new ServerSocket(0, 1, deviceAddress())) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> reference.set(activity.getBridge().getWebView()));
            WebView view = reference.get();
            String origin = "http://" + server.getInetAddress().getHostAddress() + ":" + server.getLocalPort();
            CookieManager cookies = CookieManager.getInstance();
            // Like the YouTube sign-in that the yt-dlp session leaves in the store
            cookies.setCookie(origin, "SID=signed-in");
            cookies.flush();

            AtomicReference<String> request = new AtomicReference<>();
            Thread thread = new Thread(() -> {
                try (Socket socket = server.accept()) {
                    request.set(AndroidProxyRelay.readHeaders(socket.getInputStream()));
                    socket.getOutputStream().write(("HTTP/1.1 200 OK\r\n" +
                        "Set-Cookie: VISITOR_INFO1_LIVE=tracked; Max-Age=3600\r\n" +
                        "Content-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                } catch (IOException ignored) {
                    // The assertion below reports the missing request.
                }
            }, "cookie-test-server");
            thread.start();

            try {
                await(view, "typeof window.Capacitor?.nativePromise === 'function'");
                evaluate(view, "Capacitor.nativePromise('CapacitorHttp', 'request', { url: '" + origin +
                    "/watch', method: 'GET', headers: {}, responseType: 'text' })" +
                    ".then(response => window.__cookieTestStatus = response.status," +
                    " error => window.__cookieTestStatus = String(error))");
                await(view, "window.__cookieTestStatus !== undefined");
                assertEquals("200", evaluate(view, "window.__cookieTestStatus"));
                thread.join(5000);

                assertTrue("The request reached the test server", request.get() != null);
                assertFalse(request.get(), request.get().toLowerCase(Locale.ROOT).contains("\r\ncookie:"));
                assertEquals("SID=signed-in", cookies.getCookie(origin));
            } finally {
                cookies.setCookie(origin, "SID=; Max-Age=0");
                cookies.setCookie(origin, "VISITOR_INFO1_LIVE=; Max-Age=0");
                cookies.flush();
            }
        }
    }

    /** The app's proxy relay refuses loopback destinations, so serve on the device's own address. */
    private static InetAddress deviceAddress() throws Exception {
        for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!network.isUp() || network.isLoopback()) continue;
            for (InetAddress address : Collections.list(network.getInetAddresses())) {
                if (address instanceof Inet4Address) return address;
            }
        }
        throw new AssertionError("The device has no IPv4 network address");
    }

    private static String evaluate(WebView view, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result.set(value);
            latch.countDown();
        }));
        assertTrue("JavaScript responds", latch.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private static void await(WebView view, String condition) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 15000;
        while (SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(view, condition))) return;
            Thread.sleep(100);
        }
        assertEquals(condition, "true", evaluate(view, condition));
    }
}
