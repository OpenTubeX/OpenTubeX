package org.opentubex.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.net.URL;

import org.junit.Test;

public class AndroidMediaArtworkUrlTest {
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
