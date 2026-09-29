# Capacitor, its plugins and app services use reflection and JavaScript names.
# Keep those entry points intact; R8 may still remove unused dependency code.
-dontoptimize
-dontobfuscate
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable
-keep @interface com.getcapacitor.annotation.** { *; }
-keep class com.getcapacitor.** { *; }
-keep class org.opentubex.app.** { *; }
-keep class ** extends com.getcapacitor.Plugin { *; }
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.capacitorjs.barcodescanner.** { *; }
-keep class io.capawesome.** { *; }
-keep class com.elylucas.capscreenbrightness.** { *; }
-keep class com.outsystems.plugins.barcode.** { *; }
-keep class com.yausername.** { *; }

# Commons Compress discovers ZIP extra fields by class name and constructor.
-keep class org.apache.commons.compress.archivers.zip.** implements org.apache.commons.compress.archivers.zip.ZipExtraField {
    public <init>();
}

# The barcode plugin includes an unused ML Kit backend, which Gradle excludes.
-dontwarn com.google.android.gms.tasks.OnFailureListener
-dontwarn com.google.android.gms.tasks.OnSuccessListener
-dontwarn com.google.android.gms.tasks.Task
-dontwarn com.google.mlkit.vision.barcode.BarcodeScanner
-dontwarn com.google.mlkit.vision.barcode.BarcodeScannerOptions$Builder
-dontwarn com.google.mlkit.vision.barcode.BarcodeScannerOptions
-dontwarn com.google.mlkit.vision.barcode.BarcodeScanning
-dontwarn com.google.mlkit.vision.barcode.common.Barcode
-dontwarn com.google.mlkit.vision.common.InputImage
-dontwarn com.google.gson.annotations.SerializedName
