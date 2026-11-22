package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertNull;

import android.view.InputDevice;

import org.junit.Test;

public class AndroidUiPluginTest {
    @Test
    public void physicalRotationHasAStableGapBetweenPortraitAndLandscape() {
        for (int angle : new int[] { 0, 20, 160, 180, 200, 340, 359 }) {
            assertEquals(Boolean.FALSE, AndroidUiPlugin.landscapeForDeviceOrientation(angle, false));
            assertEquals(Boolean.TRUE, AndroidUiPlugin.landscapeForDeviceOrientation(angle, true));
        }
        for (int angle : new int[] { 70, 90, 110, 250, 270, 290 }) {
            assertEquals(Boolean.TRUE, AndroidUiPlugin.landscapeForDeviceOrientation(angle, false));
            assertEquals(Boolean.FALSE, AndroidUiPlugin.landscapeForDeviceOrientation(angle, true));
        }
        for (int angle : new int[] { -1, 21, 45, 69, 111, 135, 159, 225, 315 }) {
            assertNull(AndroidUiPlugin.landscapeForDeviceOrientation(angle, false));
            assertNull(AndroidUiPlugin.landscapeForDeviceOrientation(angle, true));
        }
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

    @Test
    public void controllersWithSticksCountAsGamepadsButRemotesDoNot() {
        assertTrue(AndroidUiPlugin.isGamepadDevice(
            "Controller",
            InputDevice.SOURCE_GAMEPAD | InputDevice.SOURCE_JOYSTICK | InputDevice.SOURCE_KEYBOARD
        ));
        // A TV remote's D-pad keeps reaching the page as arrow keys.
        assertFalse(AndroidUiPlugin.isGamepadDevice(
            "Remote",
            InputDevice.SOURCE_DPAD | InputDevice.SOURCE_KEYBOARD
        ));
        // Chromium ignores this fingerprint sensor, so it must not start polling.
        assertFalse(AndroidUiPlugin.isGamepadDevice("uinput-fpc", InputDevice.SOURCE_JOYSTICK));
    }
}
