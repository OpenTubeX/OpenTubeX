package com.outsystems.plugins.barcode.controller.helper;

import android.graphics.Bitmap;
import androidx.camera.core.ImageProxy;
import com.outsystems.plugins.barcode.model.OSBARCScannerHint;
import kotlin.jvm.functions.Function0;
import kotlin.jvm.functions.Function1;

/**
 * Replaces the scanner library's ML Kit helper, which strip-mlkit.gradle
 * removes. The scanner activity always creates it, but pairing scans with ZXing.
 */
public final class OSBARCMLKitHelper implements OSBARCMLKitHelperInterface {
    public OSBARCMLKitHelper(OSBARCScannerHint hint) {}

    // Raw types keep ML Kit's Barcode class out of this class.
    @Override
    @SuppressWarnings("rawtypes")
    public void decodeImage(ImageProxy imageProxy, Bitmap imageBitmap, Function1 onSuccess, Function0 onError) {
        onError.invoke();
    }
}
