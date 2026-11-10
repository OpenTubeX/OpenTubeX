#include <node_api.h>
#import <AppKit/AppKit.h>
#include <cstring>
#include <utility>

// Electron calls this module on its main thread, which owns AppKit. Bounds
// use Electron's screen coordinates: points from the top left of the
// primary display.

static CGFloat PrimaryHeight() {
    return NSScreen.screens.firstObject.frame.size.height;
}

static NSWindow* ReadWindow(napi_env env, napi_value value) {
    int64_t number = 0;
    if (napi_get_value_int64(env, value, &number) != napi_ok) return nil;
    return [NSApp windowWithWindowNumber:static_cast<NSInteger>(number)];
}

static bool ReadDouble(napi_env env, napi_value object, const char* name, double* number) {
    napi_value value;
    return napi_get_named_property(env, object, name, &value) == napi_ok &&
        napi_get_value_double(env, value, number) == napi_ok;
}

static napi_value Null(napi_env env) {
    napi_value result;
    napi_get_null(env, &result);
    return result;
}

// Chromium keeps its Picture-in-Picture window at the floating level, which
// the app's own windows never use. Its title is translated.
static napi_value FindPictureInPictureWindow(napi_env env, napi_callback_info info) {
    size_t count = 1;
    napi_value list;
    napi_get_cb_info(env, info, &count, &list, nullptr, nullptr);
    uint32_t length = 0;
    if (count != 1 || napi_get_array_length(env, list, &length) != napi_ok) {
        napi_throw_type_error(env, nullptr, "Expected a list of native window handles");
        return nullptr;
    }
    NSMutableSet<NSWindow*>* excluded = [NSMutableSet set];
    for (uint32_t index = 0; index < length; index++) {
        napi_value item;
        void* data = nullptr;
        size_t size = 0;
        napi_get_element(env, list, index, &item);
        if (napi_get_buffer_info(env, item, &data, &size) == napi_ok && size == sizeof(void*)) {
            void* pointer;
            std::memcpy(&pointer, data, sizeof(pointer));
            NSWindow* window = ((__bridge NSView*)pointer).window;
            if (window != nil) [excluded addObject:window];
        }
    }
    NSWindow* match = nil;
    CGFloat area = 0;
    for (NSWindow* window in NSApp.windows) {
        if (!window.visible || window.level != NSFloatingWindowLevel || [excluded containsObject:window]) continue;
        CGFloat windowArea = window.frame.size.width * window.frame.size.height;
        if (windowArea > area) {
            match = window;
            area = windowArea;
        }
    }
    if (match == nil) return Null(env);
    napi_value result;
    napi_create_int64(env, match.windowNumber, &result);
    return result;
}

static napi_value GetWindowBounds(napi_env env, napi_callback_info info) {
    size_t count = 1;
    napi_value arg;
    napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
    NSWindow* window = count == 1 ? ReadWindow(env, arg) : nil;
    if (window == nil) return Null(env);
    NSRect frame = window.frame;
    napi_value result;
    napi_create_object(env, &result);
    const std::pair<const char*, double> values[] = {
        {"x", frame.origin.x},
        {"y", PrimaryHeight() - frame.origin.y - frame.size.height},
        {"width", frame.size.width},
        {"height", frame.size.height}
    };
    for (auto const& [name, number] : values) {
        napi_value value;
        napi_create_double(env, number, &value);
        napi_set_named_property(env, result, name, value);
    }
    return result;
}

static napi_value SetWindowBounds(napi_env env, napi_callback_info info) {
    size_t count = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    NSWindow* window = count == 2 ? ReadWindow(env, args[0]) : nil;
    double x, y, width, height;
    bool valid = window != nil &&
        ReadDouble(env, args[1], "x", &x) && ReadDouble(env, args[1], "y", &y) &&
        ReadDouble(env, args[1], "width", &width) && ReadDouble(env, args[1], "height", &height);
    if (valid) [window setFrame:NSMakeRect(x, PrimaryHeight() - y - height, width, height) display:YES];
    napi_value result;
    napi_get_boolean(env, valid, &result);
    return result;
}

NAPI_MODULE_INIT() {
    const napi_property_descriptor methods[] = {
        {"findPictureInPictureWindow", nullptr, FindPictureInPictureWindow, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"getWindowBounds", nullptr, GetWindowBounds, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setWindowBounds", nullptr, SetWindowBounds, nullptr, nullptr, nullptr, napi_default, nullptr}
    };
    napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods);
    return exports;
}
