package org.opentubex.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class YouTubeSessionCookiesTest {
    @Test public void exportsSessionCookiesWithoutExposingOtherDomains() {
        assertEquals("# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsession==\n.youtube.com\tTRUE\t/\tTRUE\t0\tPREF\tf6=400\n",
            YouTubeSessionCookies.serialize("SID=session==; PREF=f6=400"));
        assertThrows(IllegalArgumentException.class, () -> YouTubeSessionCookies.serialize(null));
        assertThrows(IllegalArgumentException.class, () -> YouTubeSessionCookies.serialize(""));
        assertThrows(IllegalArgumentException.class, () -> YouTubeSessionCookies.serialize("SID=value\n.evil.test\tTRUE"));
    }

    @Test public void permitsYouTubeAndGoogleLoginButRejectsUntrustedTopLevelNavigation() {
        assertTrue(YouTubeSessionCookies.canNavigate("https://accounts.google.com/ServiceLogin"));
        assertTrue(YouTubeSessionCookies.canNavigate("https://consent.google.com/"));
        assertTrue(YouTubeSessionCookies.isYouTube("https://m.youtube.com/watch?v=example"));
        assertFalse(YouTubeSessionCookies.isYouTube("https://accounts.google.com/"));
        for (String url : new String[] { null, "about:blank", "javascript:alert(1)", "file:///data/data",
            "http://youtube.com", "https://youtube.com.evil.test", "https://youtube.com@evil.test",
            "https://evil.test@youtube.com", "https://youtube.com:8443" }) {
            assertFalse(String.valueOf(url), YouTubeSessionCookies.canNavigate(url));
        }
    }
}
