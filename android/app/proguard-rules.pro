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

# strip-mlkit.gradle removes the barcode plugin's ML Kit backend. There are no
# dontwarn rules for ML Kit, so R8 fails if a reference to it comes back.
# The plugin's scan parameters use Gson annotations without bundling Gson.
-dontwarn com.google.gson.annotations.SerializedName
