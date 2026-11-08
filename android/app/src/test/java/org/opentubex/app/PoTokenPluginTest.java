package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PoTokenPluginTest {
    private static final String ATTESTED = "a".repeat(PoTokenPlugin.MAX_ATTESTED_PO_TOKEN_LENGTH);
    private static final String PENDING = "p".repeat(PoTokenPlugin.MAX_ATTESTED_PO_TOKEN_LENGTH + 4);

    private static ProxyConfiguration proxy(String hostname) {
        return new ProxyConfiguration(false, "http", hostname, "8080", "", "");
    }

    @Test
    public void keepsAnAttestedRunUntilItExpires() {
        assertEquals(1_000 + 43_200_000, PoTokenPlugin.attestationExpiry(ATTESTED, 1_000, 43_200, 3_000));
    }

    @Test
    public void discardsARunThatWasNotAttested() {
        assertEquals(0, PoTokenPlugin.attestationExpiry(PENDING, 1_000, 43_200, 3_000));
    }

    @Test
    public void discardsARunWithoutALifetime() {
        assertEquals(0, PoTokenPlugin.attestationExpiry(ATTESTED, 1_000, 0, 3_000));
        assertEquals(0, PoTokenPlugin.attestationExpiry(ATTESTED, 1_000, 1, 3_000));
    }

    @Test
    public void mintsFromAnAttestationOnTheSameRouteBeforeItExpires() {
        assertTrue(PoTokenPlugin.canMintFrom(10_000, proxy("a"), proxy("a"), 9_999));
    }

    @Test
    public void attestsAgainOnceTheAttestationExpires() {
        assertFalse(PoTokenPlugin.canMintFrom(10_000, proxy("a"), proxy("a"), 10_000));
    }

    @Test
    public void attestsAgainWhenTheProxyChanges() {
        assertFalse(PoTokenPlugin.canMintFrom(10_000, proxy("a"), proxy("b"), 1_000));
    }
}
