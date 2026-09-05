package org.opentubex.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.view.InputDevice;

import org.junit.Test;

public class AndroidUiPluginTest {
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
