package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import java.net.UnknownHostException;

import javax.net.ssl.SSLHandshakeException;

import org.json.JSONException;
import org.junit.Test;

public class SubscriptionRefreshRequestDiagnosticTest {
    @Test
    public void classifiesBackgroundFetchFailures() {
        assertEquals(
            "network",
            SubscriptionRefreshRequestDiagnostic.create("videos", new UnknownHostException("offline"))
                .failure
        );
        assertEquals(
            "network",
            SubscriptionRefreshRequestDiagnostic.create(
                "videos",
                new Exception(
                    "android_getaddrinfo failed: EAI_NODATA (No address associated with hostname)"
                )
            ).failure
        );
        assertEquals(
            "tls",
            SubscriptionRefreshRequestDiagnostic.create("live", new SSLHandshakeException("bad cert"))
                .failure
        );
        assertEquals(
            "parsing",
            SubscriptionRefreshRequestDiagnostic.create("posts", new JSONException("bad json"))
                .failure
        );
        SubscriptionRefreshRequestDiagnostic restricted =
            SubscriptionRefreshRequestDiagnostic.create(
                "videos",
                "Android background worker",
                new SecurityException("Foreground service start not allowed from the background")
            );
        assertEquals("background restriction", restricted.failure);
        assertEquals("Android background worker", restricted.backend);
    }

    @Test
    public void stripsPathsQueriesAndCredentialsFromDiagnostics() {
        Exception error = new Exception(
            "Request https://example.test/private?token=secret Authorization: Bearer secret-token"
        );
        SubscriptionRefreshRequestDiagnostic diagnostic =
            SubscriptionRefreshRequestDiagnostic.create("shorts", error);

        assertEquals("subscription Shorts", diagnostic.category);
        assertEquals("Invidious API", diagnostic.backend);
        assertEquals("background", diagnostic.lifecycle);
        assertEquals(
            "Request https://example.test Authorization: <redacted>",
            diagnostic.message
        );
        assertFalse(diagnostic.toString().contains("secret"));
    }

    @Test
    public void stripsCredentialFieldsCookiesAndRequestBodies() {
        Exception error = new Exception(
            "Cookie: SID=cookie-secret\n" +
                "token=token-secret api_key=key-secret\n" +
                "request body={\"password\":\"body-secret\"}"
        );
        SubscriptionRefreshRequestDiagnostic diagnostic =
            SubscriptionRefreshRequestDiagnostic.create("videos", error);

        for (String secret : new String[] {
            "cookie-secret",
            "token-secret",
            "key-secret",
            "body-secret",
        }) {
            assertFalse(diagnostic.message.contains(secret));
        }
        assertEquals(
            "Cookie: <redacted>\n" +
                "token=<redacted> api_key=<redacted>\n" +
                "request body=<redacted>",
            diagnostic.message
        );
    }
}
