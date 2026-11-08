#include <node_api.h>
#include <windows.h>
#include <shobjidl_core.h>
#include <winrt/Windows.ApplicationModel.DataTransfer.h>
#include <winrt/Windows.Foundation.h>
#include <cstring>
#include <map>
#include <set>
#include <string>

using namespace winrt;
using namespace Windows::ApplicationModel::DataTransfer;

// Electron calls this module on its Windows UI thread. Keep the event handler
// alive while the picker requests data, and revoke it when the window closes.
struct ShareRequest {
    DataTransferManager manager{nullptr};
    DataTransferManager::DataRequested_revoker requested;
};
static std::map<HWND, ShareRequest> requests;

static HWND ReadWindow(napi_env env, napi_value value) {
    bool isBuffer = false;
    napi_is_buffer(env, value, &isBuffer);
    void* data = nullptr;
    size_t size = 0;
    if (!isBuffer || napi_get_buffer_info(env, value, &data, &size) != napi_ok || size != sizeof(HWND)) {
        throw hresult_invalid_argument(L"Invalid native window handle");
    }
    HWND window;
    std::memcpy(&window, data, sizeof(window));
    return window;
}

static napi_value Share(napi_env env, napi_callback_info info) {
    try {
        size_t count = 2;
        napi_value args[2];
        napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
        if (count != 2) throw hresult_invalid_argument();
        HWND window = ReadWindow(env, args[0]);
        if (!IsWindow(window)) throw hresult_invalid_argument(L"The sharing window is closed");
        size_t length = 0;
        if (napi_get_value_string_utf16(env, args[1], nullptr, 0, &length) != napi_ok || length > 8192) {
            throw hresult_invalid_argument(L"Invalid share URL");
        }
        std::u16string url(length + 1, u'\0');
        napi_get_value_string_utf16(env, args[1], url.data(), url.size(), &length);
        url.resize(length);
        Windows::Foundation::Uri uri(hstring(reinterpret_cast<const wchar_t*>(url.data()), static_cast<uint32_t>(length)));
        if (uri.SchemeName() != L"https" && uri.SchemeName() != L"http") throw hresult_invalid_argument();
        auto interop = get_activation_factory<DataTransferManager, IDataTransferManagerInterop>();
        ShareRequest request;
        check_hresult(interop->GetForWindow(window, guid_of<DataTransferManager>(), put_abi(request.manager)));
        request.requested = request.manager.DataRequested(auto_revoke, [uri](auto const&, DataRequestedEventArgs const& args) {
            auto data = args.Request().Data();
            data.Properties().Title(L"OpenTubeX");
            data.SetWebLink(uri);
            data.SetText(uri.AbsoluteUri());
        });
        requests.insert_or_assign(window, std::move(request));
        HRESULT result = interop->ShowShareUIForWindow(window);
        if (FAILED(result)) requests.erase(window);
        check_hresult(result);
    } catch (hresult_error const& error) {
        napi_throw_error(env, nullptr, to_string(error.message()).c_str());
    } catch (std::exception const& error) {
        napi_throw_error(env, nullptr, error.what());
    }
    return nullptr;
}

static napi_value Close(napi_env env, napi_callback_info info) {
    try {
        size_t count = 1;
        napi_value arg;
        napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
        if (count != 1) throw hresult_invalid_argument();
        requests.erase(ReadWindow(env, arg));
    } catch (hresult_error const& error) {
        napi_throw_error(env, nullptr, to_string(error.message()).c_str());
    }
    return nullptr;
}

// Lets the foreground app keep the foreground while it opens a link in the
// background. Windows releases the lock early on user input.
static napi_value LockForeground(napi_env env, napi_callback_info info) {
    size_t count = 1;
    napi_value arg;
    bool locked = false;
    napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
    if (count != 1 || napi_get_value_bool(env, arg, &locked) != napi_ok) {
        napi_throw_type_error(env, nullptr, "Expected a boolean");
        return nullptr;
    }
    napi_value result;
    napi_get_boolean(env, LockSetForegroundWindow(locked ? LSFW_LOCK : LSFW_UNLOCK), &result);
    return result;
}

static HWND ReadHandle(napi_env env, napi_value value) {
    int64_t handle = 0;
    if (napi_get_value_int64(env, value, &handle) != napi_ok) throw hresult_invalid_argument(L"Invalid window handle");
    return reinterpret_cast<HWND>(static_cast<intptr_t>(handle));
}

static napi_value CreateRect(napi_env env, RECT const& rect) {
    napi_value result;
    napi_create_object(env, &result);
    const std::pair<const char*, LONG> values[] = {
        {"x", rect.left}, {"y", rect.top}, {"width", rect.right - rect.left}, {"height", rect.bottom - rect.top}
    };
    for (auto const& [name, number] : values) {
        napi_value value;
        napi_create_int32(env, number, &value);
        napi_set_named_property(env, result, name, value);
    }
    return result;
}

static int32_t ReadInt(napi_env env, napi_value object, const char* name) {
    napi_value value;
    int32_t number = 0;
    if (napi_get_named_property(env, object, name, &value) != napi_ok || napi_get_value_int32(env, value, &number) != napi_ok) {
        throw hresult_invalid_argument(L"Invalid window bounds");
    }
    return number;
}

static bool IsOwnWindow(HWND window) {
    DWORD process = 0;
    GetWindowThreadProcessId(window, &process);
    return process == GetCurrentProcessId() && IsWindow(window);
}

// Chromium's Picture-in-Picture window is this process's only topmost window
// besides small ones such as tooltips. Its title is translated.
static napi_value FindPictureInPictureWindow(napi_env env, napi_callback_info info) {
    try {
        size_t count = 1;
        napi_value list;
        napi_get_cb_info(env, info, &count, &list, nullptr, nullptr);
        uint32_t length = 0;
        if (count != 1 || napi_get_array_length(env, list, &length) != napi_ok) throw hresult_invalid_argument();
        struct Search {
            std::set<HWND> excluded;
            HWND match = nullptr;
            LONG area = 0;
        } search;
        for (uint32_t index = 0; index < length; index++) {
            napi_value item;
            napi_get_element(env, list, index, &item);
            search.excluded.insert(ReadWindow(env, item));
        }
        EnumWindows([](HWND window, LPARAM parameter) -> BOOL {
            auto& search = *reinterpret_cast<Search*>(parameter);
            RECT rect;
            if (search.excluded.contains(window) || !IsOwnWindow(window) || !IsWindowVisible(window) ||
                !(GetWindowLongPtrW(window, GWL_EXSTYLE) & WS_EX_TOPMOST) || !GetWindowRect(window, &rect)) {
                return TRUE;
            }
            LONG area = (rect.right - rect.left) * (rect.bottom - rect.top);
            if (area > search.area) {
                search.match = window;
                search.area = area;
            }
            return TRUE;
        }, reinterpret_cast<LPARAM>(&search));
        napi_value result;
        if (search.match == nullptr) {
            napi_get_null(env, &result);
        } else {
            napi_create_int64(env, static_cast<int64_t>(reinterpret_cast<intptr_t>(search.match)), &result);
        }
        return result;
    } catch (hresult_error const& error) {
        napi_throw_error(env, nullptr, to_string(error.message()).c_str());
        return nullptr;
    }
}

static napi_value GetWindowBounds(napi_env env, napi_callback_info info) {
    try {
        size_t count = 1;
        napi_value arg;
        napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
        if (count != 1) throw hresult_invalid_argument();
        HWND window = ReadHandle(env, arg);
        RECT rect;
        if (!IsOwnWindow(window) || !GetWindowRect(window, &rect)) {
            napi_value result;
            napi_get_null(env, &result);
            return result;
        }
        return CreateRect(env, rect);
    } catch (hresult_error const& error) {
        napi_throw_error(env, nullptr, to_string(error.message()).c_str());
        return nullptr;
    }
}

static napi_value SetWindowBounds(napi_env env, napi_callback_info info) {
    try {
        size_t count = 2;
        napi_value args[2];
        napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
        if (count != 2) throw hresult_invalid_argument();
        HWND window = ReadHandle(env, args[0]);
        bool moved = IsOwnWindow(window) && SetWindowPos(
            window, nullptr,
            ReadInt(env, args[1], "x"), ReadInt(env, args[1], "y"),
            ReadInt(env, args[1], "width"), ReadInt(env, args[1], "height"),
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER
        );
        napi_value result;
        napi_get_boolean(env, moved, &result);
        return result;
    } catch (hresult_error const& error) {
        napi_throw_error(env, nullptr, to_string(error.message()).c_str());
        return nullptr;
    }
}

NAPI_MODULE_INIT() {
    const napi_property_descriptor methods[] = {
        {"share", nullptr, Share, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"close", nullptr, Close, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"lockForeground", nullptr, LockForeground, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"findPictureInPictureWindow", nullptr, FindPictureInPictureWindow, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"getWindowBounds", nullptr, GetWindowBounds, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"setWindowBounds", nullptr, SetWindowBounds, nullptr, nullptr, nullptr, napi_default, nullptr}
    };
    napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods);
    napi_add_env_cleanup_hook(env, [](void*) { requests.clear(); }, nullptr);
    return exports;
}
