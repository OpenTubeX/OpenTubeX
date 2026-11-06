package org.opentubex.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AndroidMediaActionsTest {
    @Test
    public void acceptsOnlyRendererMediaActions() {
        assertTrue(AndroidMediaActions.isSupported(AndroidMediaActions.PLAY));
        assertTrue(AndroidMediaActions.isSupported(AndroidMediaActions.SEEK_TO));
        assertTrue(AndroidMediaActions.isSupported(AndroidMediaActions.NEXT));
        assertFalse(AndroidMediaActions.isSupported("reload"));
        assertFalse(AndroidMediaActions.isSupported(""));
    }
}
