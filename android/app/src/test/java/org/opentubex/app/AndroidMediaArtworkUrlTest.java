package org.opentubex.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.fail;

import java.io.ByteArrayInputStream;
import java.net.URL;

import org.junit.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.List;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.lang.reflect.Field;
import okhttp3.OkHttpClient;
import okhttp3.Dns;

public class AndroidMediaArtworkUrlTest {
    @Test public void dnsReturnsExactlyTheValidatedAnswerAndRejectsRebinding() throws Exception {
        AtomicInteger lookups = new AtomicInteger();
        List<InetAddress> publicAnswer = List.of(InetAddress.getByName("8.8.8.8"));
        Dns dns = AndroidMediaArtwork.publicDns(host -> lookups.getAndIncrement() == 0
            ? publicAnswer : List.of(InetAddress.getByName("127.0.0.1")));
        assertSame(publicAnswer, dns.lookup("artwork.example"));
        assertEquals(1, lookups.get());
        assertThrows(UnknownHostException.class, () -> dns.lookup("artwork.example"));
    }

    @Test public void replacementDoesNotWaitForObsoleteDns() throws Exception {
        CountDownLatch first = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch second = new CountDownLatch(1);
        OkHttpClient client = new OkHttpClient.Builder().dns(host -> {
            if (host.equals("example.com")) {
                first.countDown();
                try { release.await(); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            } else second.countDown();
            throw new UnknownHostException("Test ends before connecting");
        }).build();
        try (AndroidMediaArtwork artwork = new AndroidMediaArtwork(Runnable::run)) {
            Field field = AndroidMediaArtwork.class.getDeclaredField("client");
            field.setAccessible(true);
            field.set(artwork, client);
            artwork.load("https://example.com/image", bitmap -> fail());
            assertTrue(first.await(5, TimeUnit.SECONDS));
            artwork.load("https://example.org/image", bitmap -> fail());
            assertTrue("Replacement starts while obsolete DNS is blocked",
                second.await(2, TimeUnit.SECONDS));
        } finally {
            release.countDown();
            client.dispatcher().executorService().shutdownNow();
        }
    }

    @Test public void connectionDnsRejectsPrivateAddresses() throws Exception {
        try (AndroidMediaArtwork artwork = new AndroidMediaArtwork(Runnable::run)) {
            Field field = AndroidMediaArtwork.class.getDeclaredField("client");
            field.setAccessible(true);
            OkHttpClient client = (OkHttpClient) field.get(artwork);
            assertThrows(UnknownHostException.class,
                () -> client.dns().lookup("127.0.0.1"));
        }
    }

    @Test
    public void acceptsPublicHttpsArtworkUrls() throws Exception {
        assertTrue(AndroidMediaArtwork.isSafeArtworkUrl(
            new URL("https://8.8.8.8/thumbnail.jpg")
        ));
    }

    @Test
    public void rejectsUnsafeArtworkSchemesAndCredentials() throws Exception {
        assertFalse(AndroidMediaArtwork.isSafeArtworkUrl(
            new URL("http://8.8.8.8/thumbnail.jpg")
        ));
        assertFalse(AndroidMediaArtwork.isSafeArtworkUrl(
            new URL("https://user:password@8.8.8.8/thumbnail.jpg")
        ));
    }

    @Test
    public void rejectsLocalAndPrivateArtworkAddresses() throws Exception {
        String[] addresses = {
            "127.0.0.1",
            "１２７.０.０.１",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.0.1",
            "169.254.1.1",
            "100.64.0.1",
            "[::1]",
            "[fc00::1]"
        };
        for (String address : addresses) {
            assertFalse(AndroidMediaArtwork.isSafeArtworkUrl(
                new URL("https://" + address + "/thumbnail.jpg")
            ));
        }
    }

    @Test
    public void boundsArtworkResponsesWithAndWithoutContentLength() throws Exception {
        byte[] allowed = new byte[AndroidMediaArtwork.MAX_ARTWORK_BYTES];
        assertArrayEquals(allowed, AndroidMediaArtwork.readArtworkBytes(
            new ByteArrayInputStream(allowed),
            allowed.length
        ));

        assertNull(AndroidMediaArtwork.readArtworkBytes(
            new ByteArrayInputStream(new byte[0]),
            AndroidMediaArtwork.MAX_ARTWORK_BYTES + 1L
        ));
        assertNull(AndroidMediaArtwork.readArtworkBytes(
            new ByteArrayInputStream(new byte[AndroidMediaArtwork.MAX_ARTWORK_BYTES + 1]),
            -1
        ));
    }

    @Test
    public void acceptsOnlyBoundedDecodedArtworkDimensions() {
        assertTrue(AndroidMediaArtwork.hasSafeArtworkDimensions(1280, 720));
        assertTrue(AndroidMediaArtwork.hasSafeArtworkDimensions(2048, 2048));

        assertFalse(AndroidMediaArtwork.hasSafeArtworkDimensions(0, 720));
        assertFalse(AndroidMediaArtwork.hasSafeArtworkDimensions(2049, 1));
        assertFalse(AndroidMediaArtwork.hasSafeArtworkDimensions(2048, 2049));
        assertFalse(AndroidMediaArtwork.hasSafeArtworkDimensions(
            Integer.MAX_VALUE,
            Integer.MAX_VALUE
        ));
    }

    @Test
    public void downsamplesOversizedArtworkBeforeAllocation() {
        assertEquals(1, AndroidMediaArtwork.calculateArtworkSampleSize(1280, 720));
        assertEquals(2, AndroidMediaArtwork.calculateArtworkSampleSize(4096, 2048));
        assertEquals(4, AndroidMediaArtwork.calculateArtworkSampleSize(8000, 4000));
        assertEquals(0, AndroidMediaArtwork.calculateArtworkSampleSize(-1, 720));
    }
}
