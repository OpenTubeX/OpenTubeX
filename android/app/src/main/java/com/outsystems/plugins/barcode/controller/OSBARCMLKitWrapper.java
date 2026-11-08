package com.outsystems.plugins.barcode.controller;

import android.graphics.Bitmap;
import androidx.camera.core.ImageProxy;
import com.outsystems.plugins.barcode.controller.helper.OSBARCMLKitHelperInterface;
import com.outsystems.plugins.barcode.model.OSBARCError;
import com.outsystems.plugins.barcode.model.OSBARCScanResult;
import kotlin.Unit;
import kotlin.jvm.functions.Function1;

/**
 * Replaces the scanner library's ML Kit backend, which strip-mlkit.gradle
 * removes. Requests for ML Kit scanning fail instead of loading Google code.
 */
public final class OSBARCMLKitWrapper implements OSBARCScanLibraryInterface {
    public OSBARCMLKitWrapper(OSBARCMLKitHelperInterface helper) {}

    @Override
    public void scanBarcode(
        ImageProxy imageProxy,
        Bitmap imageBitmap,
        Function1<? super OSBARCScanResult, Unit> onSuccess,
        Function1<? super OSBARCError, Unit> onError
    ) {
        onError.invoke(OSBARCError.SCANNING_GENERAL_ERROR);
    }
}
