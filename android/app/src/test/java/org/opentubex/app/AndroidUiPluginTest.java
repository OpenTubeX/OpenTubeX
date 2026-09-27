package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.view.InputDevice;

import org.junit.Test;

public class AndroidUiPluginTest {
    @Test
    public void physicalRotationClassifiesOnlyStablePortraitAndLandscapeAngles() {
        assertEquals(Boolean.FALSE, AndroidUiPlugin.landscapeForDegrees(0));
        assertEquals(Boolean.TRUE, AndroidUiPlugin.landscapeForDegrees(90));
        assertEquals(Boolean.FALSE, AndroidUiPlugin.landscapeForDegrees(180));
        assertEquals(Boolean.TRUE, AndroidUiPlugin.landscapeForDegrees(270));
        assertNull(AndroidUiPlugin.landscapeForDegrees(45));
        assertNull(AndroidUiPlugin.landscapeForDegrees(-1));
    }

    @Test
    public void onlyNonVirtualAlphabeticDevicesCountAsHardwareKeyboards() {
        assertFalse(AndroidUiPlugin.isHardwareKeyboardDevice(null));
        assertFalse(AndroidUiPlugin.isHardwareKeyboardDevice(
            true,
            InputDevice.KEYBOARD_TYPE_ALPHABETIC
        ));
        assertFalse(AndroidUiPlugin.isHardwareKeyboardDevice(
            false,
            InputDevice.KEYBOARD_TYPE_NON_ALPHABETIC
        ));
        assertTrue(AndroidUiPlugin.isHardwareKeyboardDevice(
            false,
            InputDevice.KEYBOARD_TYPE_ALPHABETIC
        ));
    }
}
