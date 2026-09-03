package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import java.util.HashSet;
import java.util.Set;

import org.junit.Test;

public class AndroidMediaNotificationStateTest {
    @Test
    public void positionOnlyUpdatesDoNotChangeNotificationSignature() {
        Set<String> actions = new HashSet<>();
        actions.add(AndroidMediaActions.PAUSE);
        actions.add(AndroidMediaActions.STOP);

        String metadata = AndroidMediaNotificationState.metadataSignature(
            "Video", "Channel", 120_000, "https://example.com/art.jpg", true
        );
        String first = AndroidMediaNotificationState.notificationSignature(metadata, "playing", actions);
        String second = AndroidMediaNotificationState.notificationSignature(metadata, "playing", actions);

        assertEquals(first, second);
    }

    @Test
    public void visibleNotificationChangesInvalidateItsSignature() {
        Set<String> actions = new HashSet<>();
        actions.add(AndroidMediaActions.PAUSE);

        String withoutArtwork = AndroidMediaNotificationState.metadataSignature(
            "Video", "Channel", 120_000, "https://example.com/art.jpg", false
        );
        String withArtwork = AndroidMediaNotificationState.metadataSignature(
            "Video", "Channel", 120_000, "https://example.com/art.jpg", true
        );

        assertNotEquals(withoutArtwork, withArtwork);
        assertNotEquals(
            AndroidMediaNotificationState.notificationSignature(withArtwork, "playing", actions),
            AndroidMediaNotificationState.notificationSignature(withArtwork, "paused", actions)
        );
    }
}
