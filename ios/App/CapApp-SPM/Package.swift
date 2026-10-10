// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS("17.4")],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(name: "OpenTubeXFFmpeg", path: "../FFmpegKit"),
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.3"),
        .package(name: "CapacitorCommunityKeepAwake", path: "../../../node_modules/.pnpm/@capacitor-community+keep-awake@8.0.1_@capacitor+core@8.5.3/node_modules/@capacitor-community/keep-awake"),
        .package(name: "CapacitorCommunityScreenBrightness", path: "../../../node_modules/.pnpm/@capacitor-community+screen-brightness@8.0.0_@capacitor+core@8.5.3/node_modules/@capacitor-community/screen-brightness"),
        .package(name: "CapacitorApp", path: "../../../node_modules/.pnpm/@capacitor+app@8.1.2_@capacitor+core@8.5.3/node_modules/@capacitor/app"),
        .package(name: "CapacitorBarcodeScanner", path: "../../../node_modules/.pnpm/@capacitor+barcode-scanner@3.1.2_patch_hash=b4c45d0161b7a4f0e708d232e3d2067f01a39f1ffb5_1b3dfb390a89a640f08863e586056c2f/node_modules/@capacitor/barcode-scanner"),
        .package(name: "CapacitorBrowser", path: "../../../node_modules/.pnpm/@capacitor+browser@8.0.5_@capacitor+core@8.5.3/node_modules/@capacitor/browser"),
        .package(name: "CapacitorDevice", path: "../../../node_modules/.pnpm/@capacitor+device@8.0.3_@capacitor+core@8.5.3/node_modules/@capacitor/device"),
        .package(name: "CapacitorFilesystem", path: "../../../node_modules/.pnpm/@capacitor+filesystem@8.1.4_@capacitor+core@8.5.3/node_modules/@capacitor/filesystem"),
        .package(name: "CapacitorHaptics", path: "../../../node_modules/.pnpm/@capacitor+haptics@8.0.2_@capacitor+core@8.5.3/node_modules/@capacitor/haptics"),
        .package(name: "CapacitorLocalNotifications", path: "../../../node_modules/.pnpm/@capacitor+local-notifications@8.3.1_@capacitor+core@8.5.3/node_modules/@capacitor/local-notifications"),
        .package(name: "CapacitorShare", path: "../../../node_modules/.pnpm/@capacitor+share@8.0.3_patch_hash=61a10a5a91f7c78b0670870fd26034ee015a175f24f79c0f9890ce03050a8adb_@capacitor+core@8.5.3/node_modules/@capacitor/share"),
        .package(name: "CapawesomeCapacitorAppShortcuts", path: "../../../node_modules/.pnpm/@capawesome+capacitor-app-shortcuts@8.0.2_patch_hash=2581c86d60ce7892c0b3136523994591d2_7bda5f8ab217cb5716241708ca9b817e/node_modules/@capawesome/capacitor-app-shortcuts"),
        .package(name: "CapawesomeCapacitorClipboard", path: "../../../node_modules/.pnpm/@capawesome+capacitor-clipboard@0.1.2_patch_hash=729c6071cbf0e196e2212b015677cdd162c287_3e03c52dbfb27d0586ba4fa212038a19/node_modules/@capawesome/capacitor-clipboard"),
        .package(name: "CapawesomeCapacitorScreenOrientation", path: "../../../node_modules/.pnpm/@capawesome+capacitor-screen-orientation@8.0.3_@capacitor+core@8.5.3/node_modules/@capawesome/capacitor-screen-orientation"),
        .package(name: "CapawesomeCapacitorSettingsLauncher", path: "../../../node_modules/.pnpm/@capawesome+capacitor-settings-launcher@0.1.2_@capacitor+core@8.5.3/node_modules/@capawesome/capacitor-settings-launcher"),
        .package(name: "CapawesomeCapacitorVolume", path: "../../../node_modules/.pnpm/@capawesome+capacitor-volume@0.1.3_@capacitor+core@8.5.3/node_modules/@capawesome/capacitor-volume")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "OpenTubeXFFmpeg", package: "OpenTubeXFFmpeg"),
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCommunityKeepAwake", package: "CapacitorCommunityKeepAwake"),
                .product(name: "CapacitorCommunityScreenBrightness", package: "CapacitorCommunityScreenBrightness"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorBarcodeScanner", package: "CapacitorBarcodeScanner"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser"),
                .product(name: "CapacitorDevice", package: "CapacitorDevice"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapacitorHaptics", package: "CapacitorHaptics"),
                .product(name: "CapacitorLocalNotifications", package: "CapacitorLocalNotifications"),
                .product(name: "CapacitorShare", package: "CapacitorShare"),
                .product(name: "CapawesomeCapacitorAppShortcuts", package: "CapawesomeCapacitorAppShortcuts"),
                .product(name: "CapawesomeCapacitorClipboard", package: "CapawesomeCapacitorClipboard"),
                .product(name: "CapawesomeCapacitorScreenOrientation", package: "CapawesomeCapacitorScreenOrientation"),
                .product(name: "CapawesomeCapacitorSettingsLauncher", package: "CapawesomeCapacitorSettingsLauncher"),
                .product(name: "CapawesomeCapacitorVolume", package: "CapawesomeCapacitorVolume")
            ]
        )
    ]
)
