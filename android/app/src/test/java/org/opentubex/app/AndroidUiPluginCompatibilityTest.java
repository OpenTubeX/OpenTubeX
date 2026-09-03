package org.opentubex.app;

import static org.junit.Assert.assertNotEquals;

import android.app.PictureInPictureParams;

import java.lang.reflect.Method;

import org.junit.Test;

public class AndroidUiPluginCompatibilityTest {
    @Test
    public void capacitorCanReflectPluginMethodsOnAndroidSeven() {
        for (Method method : AndroidUiPlugin.class.getDeclaredMethods()) {
            assertNotEquals(PictureInPictureParams.class, method.getReturnType());
            for (Class<?> parameterType : method.getParameterTypes()) {
                assertNotEquals(PictureInPictureParams.class, parameterType);
            }
        }
    }
}
