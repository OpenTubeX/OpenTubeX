# Android signing

Gradle signs debug and nightly APKs with `nightly.keystore`. Its credentials are public by design, so local builds stay installable. These builds use separate application IDs so they cannot update the production `org.opentubex.app` package or access its private data. This key must never sign the production package.

Published nightlies are re-signed with a private nightly key, so nobody else can publish an update for them. See [Nightly signing](#nightly-signing).

| Build | Command from `android/` | Application ID | Launcher name |
| --- | --- | --- | --- |
| Local development | `./gradlew assembleDebug` | `org.opentubex.app.dev` | OpenTubeX Dev |
| Published nightly | `./gradlew assembleNightly` | `org.opentubex.app.nightly` | OpenTubeX Nightly |

CI explicitly selects the nightly identity. Local builds default to Dev even when version environment variables are set, so F-Droid and Obtainium cannot replace a local test build with a published nightly. Dev uses a cyan flask badge; Nightly keeps its amber wrench. Both include monochrome themed icons. Local debug APKs are written to `app/build/outputs/apk/debug/app-debug.apk`; nightly APKs use `app/build/outputs/apk/nightly/`.

CI builds `:app:assembleNightly -PsplitApks` for nightlies and `:app:assembleRelease -PsplitApks` for official releases. F-Droid builds the nightly variant from the stable release tag and signs it with the nightly key, so existing nightly installations receive it. Both shrink unused bytecode while keeping app and Capacitor runtime entry points, without optimization, obfuscation or resource shrinking. Architecture splits and removal of the unused QuickJS static archive still reduce download sizes. The builds produce standalone ARM64, ARMv7, x86, x86_64 and universal APKs. Each APK has its own version code, which F-Droid requires: ten times the base code, plus 1 for ARMv7, 2 for x86, 3 for ARM64 and 4 for x86_64. The universal APK adds nothing, and devices that run both 32-bit and 64-bit code prefer the 64-bit APK. Local debug builds produce one APK.

Base version codes use twice the Git commit count for nightlies and add one for stable releases. This lets stable code update a nightly built from the same commit, while the next commit's nightly can update the promoted package. Nightly CI passes the base code in `ANDROID_VERSION_CODE`. Stable releases read it from `app/version.properties`, which the Create Draft Release workflow sets in the release commit and the release workflow checks against the commit count, so F-Droid can rebuild the release from its tag. Without `ANDROID_VERSION_NAME`, the version name comes from `package.json`.

Stable releases attach only production APKs to the application's GitHub release. F-Droid builds and publishes the promoted nightly APK directly in its signed repository, without creating another GitHub release.

`python3 _scripts/android_apks.py android/app/build/outputs/apk/nightly android-apks` validates the complete output set, stages the download filenames and prints a size breakdown. Use the `release` directory and `--release` for production. The universal release filename is `org.opentubex.app-VERSION-beta.apk`. CI rejects APKs over 75 MiB per architecture or 225 MiB universal; the universal budget includes bundled SQLite and the Go helpers for all four architectures. Adjust these budgets deliberately when adding runtime dependencies.

Stable and nightly releases also publish lite APKs for devices with little storage. Stable filenames are `org.opentubex.app-VERSION-beta-lite[-ABI].apk`; nightly filenames are `opentubex-VERSION-android-lite-ABI.apk`, with `universal` as the ABI for the universal APK. Build them with `-Plite`; they omit the yt-dlp runtime, FFmpeg and the Rumble helper, and the app hides downloads, the yt-dlp playback engine and cookie-authenticated features. Validate them with `--lite`, which rejects packaged runtime files and applies budgets of 20 MiB per architecture and 35 MiB universal. Lite builds append `.lite` to the application ID and ` Lite` to the launcher name: `org.opentubex.app.lite` (OpenTubeX Lite), `org.opentubex.app.nightly.lite` (OpenTubeX Nightly Lite) and `org.opentubex.app.dev.lite` (OpenTubeX Dev Lite). They install alongside the full builds with their own data, so app stores can list them as separate apps. Verify their identities by adding `-Plite` to the commands below.

Dev installs alongside Nightly and production with its own settings, subscriptions, history and files. The first Dev installation starts fresh; existing Nightly data stays in Nightly and is not copied automatically. Further Dev APKs update the Dev installation.

After syncing Capacitor, verify the package IDs, launcher names, instrumentation IDs and nightly signing key from the repository root:

```sh
./android/gradlew -p android -I ../tests/android/build-identity.init.gradle verifyBuildIdentity
./android/gradlew -p android -I ../tests/android/build-identity.init.gradle verifyBuildIdentity -PtestBuildType=nightly
```

Launch a local build for Android user 0 with:

```sh
adb -s DEVICE_SERIAL shell am start --user 0 \
  -n org.opentubex.app.dev/org.opentubex.app.MainActivity
```

Signed release builds require the private OpenTubeX Android release key. Gradle refuses to run a release task unless both environment variables are present, or `-PunsignedRelease` requests an unsigned APK, as F-Droid's rebuild does:

- `ANDROID_RELEASE_KEYSTORE`: absolute path to the private keystore
- `ANDROID_RELEASE_STORE_PASSWORD`: keystore password

The key alias is `opentubex-android-release`. The key password and keystore password are the same.

GitHub Actions stores the same material in these repository secrets:

- `ANDROID_RELEASE_KEYSTORE_BASE64`: base64-encoded keystore
- `ANDROID_RELEASE_KEYSTORE_PASSWORD`: keystore password

The private keystore and its password are permanent release assets. Losing either one prevents publishing updates that install over existing OpenTubeX Android releases. Keep at least two encrypted backups in separate locations and test recovery before the first public release.

## Nightly signing

Nightlies used to be published with the public `nightly.keystore`, so anyone could sign an APK that updates them. CI now re-signs every published nightly APK with `_scripts/sign-nightly-apks.sh`. It signs with the private nightly key using APK Signature Scheme v3 key rotation, linked from the public key by the committed `nightly.lineage`:

- Android 9 and later install the update over a publicly signed nightly, keep its data, and then reject APKs signed only with the public key. Through the lineage, the public key keeps the installed-data and permission capabilities, which are needed to update the existing installation and the signature permission it declares. It has no rollback, auth or shared UID capabilities.
- Android 8 does not support v3, so it keeps verifying the public key's v2 signature and stays exposed.
- Devices that installed an attacker's rotation from the public key before the first privately signed nightly must reinstall OpenTubeX Nightly.

The private key's alias is `opentubex-android-nightly` and its certificate SHA-256 digest is `ae70934782cd4f6183777e3fbabcfe4cdcb6a51b404afff727c90c49e6907b5a`. The script fails if the APK's v3 signer has another digest. It reads the key from these environment variables:

- `ANDROID_NIGHTLY_KEYSTORE`: absolute path to the private PKCS #12 keystore
- `ANDROID_NIGHTLY_STORE_PASSWORD`: keystore password

GitHub Actions stores the keystore in the `ANDROID_NIGHTLY_KEYSTORE_BASE64` and `ANDROID_NIGHTLY_KEYSTORE_PASSWORD` secrets, both here and in `OpenTubeX/fdroid`, which re-signs the stable code it builds for nightly installations. Stock fdroidserver skips APKs whose v2 and v3 certificates differ, so `OpenTubeX/fdroid` indexes nightlies through its `scripts/fdroid.py`, which lists the public certificate as the signer. F-Droid clients read that oldest certificate from rotated installations. Fork builds without the secrets keep the public signature. Like the release key, the private nightly key and its password are permanent: losing them prevents publishing updates that install over existing nightlies, so keep encrypted backups.

Do not regenerate `nightly.lineage`. To rotate again, extend it with `apksigner rotate --in nightly.lineage`, so devices that already trust the private key accept the next one.

APK signature fingerprints can be checked with:

```sh
"$ANDROID_HOME"/build-tools/<version>/apksigner verify --verbose --print-certs app-release.apk
```

`keytool -printcert -jarfile` shows nothing, because these APKs have no v1 signature.

## F-Droid reproducible builds

F-Droid rebuilds each stable release from its tag with `:app:assembleRelease -PsplitApks -PunsignedRelease`. If its unsigned APK matches the published one apart from the signature, F-Droid distributes the APK signed with the OpenTubeX release key. Keep the release build reproducible:

- Build with the Go toolchain from `_scripts/cast-sender/go.mod`, the NDK in `app/build.gradle`, Java 21 and the pnpm version in `package.json`'s `packageManager` field.
- Install 7-Zip. Release builds fail without it because the other packer produces different runtime archives.
- Do not embed timestamps, absolute paths or CI-only environment variables in the web bundle or APK. The web bundle embeds the checked-out commit rather than `GITHUB_SHA`.
- The APK must not include Google's encrypted dependency metadata block.
