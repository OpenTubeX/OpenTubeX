package org.opentubex.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.net.URL;

import org.junit.Test;

public class AndroidMediaArtworkUrlTest {
    @Test
    public void acceptsPublicHttpsArtworkUrls() throws Exception {
        assertTrue(AndroidMediaSessionService.isSafeArtworkUrl(
            new URL("https://8.8.8.8/thumbnail.jpg")
        ));
    }

    @Test
    public void rejectsUnsafeArtworkSchemesAndCredentials() throws Exception {
        assertFalse(AndroidMediaSessionService.isSafeArtworkUrl(
            new URL("http://8.8.8.8/thumbnail.jpg")
        ));
        assertFalse(AndroidMediaSessionService.isSafeArtworkUrl(
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
            assertFalse(AndroidMediaSessionService.isSafeArtworkUrl(
                new URL("https://" + address + "/thumbnail.jpg")
            ));
        }
    }
}
