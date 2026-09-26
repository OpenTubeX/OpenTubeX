// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v17)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.2"),
        .package(name: "CapacitorCommunityKeepAwake", path: "../../../node_modules/.pnpm/@capacitor-community+keep-awake@8.0.1_@capacitor+core@8.5.2/node_modules/@capacitor-community/keep-awake"),
        .package(name: "CapacitorCommunityScreenBrightness", path: "../../../node_modules/.pnpm/@capacitor-community+screen-brightness@8.0.0_@capacitor+core@8.5.2/node_modules/@capacitor-community/screen-brightness"),
        .package(name: "CapacitorApp", path: "../../../node_modules/.pnpm/@capacitor+app@8.1.1_@capacitor+core@8.5.2/node_modules/@capacitor/app"),
        .package(name: "CapacitorBarcodeScanner", path: "../../../node_modules/.pnpm/@capacitor+barcode-scanner@3.1.2_patch_hash=b4c45d0161b7a4f0e708d232e3d2067f01a39f1ffb5_e8b85e0c3ff7d0824f84bc56f5f11f17/node_modules/@capacitor/barcode-scanner"),
        .package(name: "CapacitorBrowser", path: "../../../node_modules/.pnpm/@capacitor+browser@8.0.4_@capacitor+core@8.5.2/node_modules/@capacitor/browser"),
        .package(name: "CapacitorDevice", path: "../../../node_modules/.pnpm/@capacitor+device@8.0.3_@capacitor+core@8.5.2/node_modules/@capacitor/device"),
        .package(name: "CapacitorFilesystem", path: "../../../node_modules/.pnpm/@capacitor+filesystem@8.1.3_@capacitor+core@8.5.2/node_modules/@capacitor/filesystem"),
        .package(name: "CapacitorLocalNotifications", path: "../../../node_modules/.pnpm/@capacitor+local-notifications@8.3.1_@capacitor+core@8.5.2/node_modules/@capacitor/local-notifications"),
        .package(name: "CapacitorShare", path: "../../../node_modules/.pnpm/@capacitor+share@8.0.2_@capacitor+core@8.5.2/node_modules/@capacitor/share"),
        .package(name: "CapawesomeCapacitorAppShortcuts", path: "../../../node_modules/.pnpm/@capawesome+capacitor-app-shortcuts@8.0.2_patch_hash=2581c86d60ce7892c0b3136523994591d2_5eba2b4c586967c767d87dc4824f83e0/node_modules/@capawesome/capacitor-app-shortcuts"),
        .package(name: "CapawesomeCapacitorClipboard", path: "../../../node_modules/.pnpm/@capawesome+capacitor-clipboard@0.1.2_patch_hash=729c6071cbf0e196e2212b015677cdd162c287_9becbaf87dac5fb81acdb26e03b150ee/node_modules/@capawesome/capacitor-clipboard"),
        .package(name: "CapawesomeCapacitorScreenOrientation", path: "../../../node_modules/.pnpm/@capawesome+capacitor-screen-orientation@8.0.3_@capacitor+core@8.5.2/node_modules/@capawesome/capacitor-screen-orientation"),
        .package(name: "CapawesomeCapacitorSettingsLauncher", path: "../../../node_modules/.pnpm/@capawesome+capacitor-settings-launcher@0.1.2_@capacitor+core@8.5.2/node_modules/@capawesome/capacitor-settings-launcher"),
        .package(name: "CapawesomeCapacitorVolume", path: "../../../node_modules/.pnpm/@capawesome+capacitor-volume@0.1.3_@capacitor+core@8.5.2/node_modules/@capawesome/capacitor-volume")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCommunityKeepAwake", package: "CapacitorCommunityKeepAwake"),
                .product(name: "CapacitorCommunityScreenBrightness", package: "CapacitorCommunityScreenBrightness"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorBarcodeScanner", package: "CapacitorBarcodeScanner"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser"),
                .product(name: "CapacitorDevice", package: "CapacitorDevice"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
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
