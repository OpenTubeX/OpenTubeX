# Android signing

Debug APKs use `nightly.keystore`. Its credentials are public by design, so debug builds use the separate `org.opentubex.app.nightly` application ID. This prevents a publicly signed APK from updating the production `org.opentubex.app` package or accessing its private data. The nightly identity is for preview builds only and must never sign an APK offered as an official release.

Release builds require the private OpenTubeX Android release key. Gradle refuses to run a release task unless both environment variables are present:

- `ANDROID_RELEASE_KEYSTORE`: absolute path to the private keystore
- `ANDROID_RELEASE_STORE_PASSWORD`: keystore password

The key alias is `opentubex-android-release`. The key password and keystore password are the same.

GitHub Actions stores the same material in these repository secrets:

- `ANDROID_RELEASE_KEYSTORE_BASE64`: base64-encoded keystore
- `ANDROID_RELEASE_KEYSTORE_PASSWORD`: keystore password

The private keystore and its password are permanent release assets. Losing either one prevents publishing updates that install over existing OpenTubeX Android releases. Keep at least two encrypted backups in separate locations and test recovery before the first public release.

APK signature fingerprints can be checked with:

```sh
keytool -printcert -jarfile app-release.apk
```
