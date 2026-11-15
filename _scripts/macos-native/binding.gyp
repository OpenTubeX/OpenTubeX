{
  "targets": [{
    "target_name": "macos_native",
    "sources": ["window.mm"],
    "defines": ["NAPI_VERSION=8"],
    "libraries": ["-framework AppKit"],
    "xcode_settings": {
      "CLANG_ENABLE_OBJC_ARC": "YES",
      "MACOSX_DEPLOYMENT_TARGET": "12.0"
    }
  }]
}
