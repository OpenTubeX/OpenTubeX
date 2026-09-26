import Capacitor
import UniformTypeIdentifiers
import WebKit

@objc(IOSStoragePlugin)
public class IOSStoragePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "IOSStoragePlugin"
    public let jsName = "IOSStorage"
    public let pluginMethods: [CAPPluginMethod] = ["saveFile", "chooseDirectory", "getUsage", "clearCache"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }
    private var pending: CAPPluginCall?
    private var temporary: URL?

    @objc func chooseDirectory(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil else { call.reject("A file picker is already open"); return }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            self.present(picker, call: call)
        }
    }

    @objc func saveFile(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil else { call.reject("A file picker is already open"); return }
            guard let name = call.getString("fileName"), !name.isEmpty,
                  name == (name as NSString).lastPathComponent, name != ".", name != "..",
                  let base64 = call.getString("data"), let data = Data(base64Encoded: base64) else {
                call.reject("Invalid file")
                return
            }
            do {
                if let reference = call.getString("directory"), !reference.isEmpty {
                    guard let object = try JSONSerialization.jsonObject(with: Data(reference.utf8)) as? [String: String],
                          let bookmark = object["bookmark"], let bytes = Data(base64Encoded: bookmark) else { throw URLError(.noPermissionsToReadFile) }
                    var stale = false
                    let directory = try URL(resolvingBookmarkData: bytes, options: [], bookmarkDataIsStale: &stale)
                    guard directory.startAccessingSecurityScopedResource() else { throw URLError(.noPermissionsToReadFile) }
                    defer { directory.stopAccessingSecurityScopedResource() }
                    try data.write(to: directory.appendingPathComponent(name), options: .atomic)
                    call.resolve(["saved": true])
                    return
                }
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                self.temporary = directory
                let file = directory.appendingPathComponent(name)
                try data.write(to: file, options: .atomic)
                self.present(UIDocumentPickerViewController(forExporting: [file], asCopy: true), call: call)
            } catch {
                self.cleanup()
                call.reject(error.localizedDescription)
            }
        }
    }

    private func present(_ picker: UIDocumentPickerViewController, call: CAPPluginCall) {
        guard let controller = bridge?.viewController else { cleanup(); call.reject("No active window"); return }
        guard controller.presentedViewController == nil else {
            cleanup()
            call.reject("Another dialog is already open")
            return
        }
        pending = call
        picker.delegate = self
        picker.allowsMultipleSelection = false
        controller.present(picker, animated: true)
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pending else { return }
        defer { cleanup() }
        if temporary != nil { call.resolve(["saved": true]); return }
        guard let url = urls.first, url.startAccessingSecurityScopedResource() else { call.reject("Folder access was denied"); return }
        defer { url.stopAccessingSecurityScopedResource() }
        do {
            let bookmark = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
            let reference = try JSONSerialization.data(withJSONObject: ["name": url.lastPathComponent, "bookmark": bookmark.base64EncodedString()])
            call.resolve(["path": String(decoding: reference, as: UTF8.self)])
        }
        catch { call.reject(error.localizedDescription) }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pending?.resolve(temporary == nil ? ["path": NSNull()] : ["saved": false])
        cleanup()
    }

    private func cleanup() {
        if let temporary = temporary { try? FileManager.default.removeItem(at: temporary) }
        temporary = nil
        pending = nil
    }

    @objc func getUsage(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .utility).async {
            let manager = FileManager.default
            func bytes(_ directory: URL?) -> Int64 {
                guard let directory = directory, let files = manager.enumerator(at: directory, includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey], options: []) else { return 0 }
                return files.compactMap { $0 as? URL }.reduce(0) { total, url in
                    let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
                    return total + (values?.isRegularFile == true ? Int64(values?.fileSize ?? 0) : 0)
                }
            }
            let cache = bytes(manager.urls(for: .cachesDirectory, in: .userDomainMask).first)
            let library = bytes(manager.urls(for: .libraryDirectory, in: .userDomainMask).first)
            let documents = bytes(manager.urls(for: .documentDirectory, in: .userDomainMask).first)
            call.resolve(["appDataBytes": max(0, library - cache) + documents,
                          "cacheBytes": cache])
        }
    }

    @objc func clearCache(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // Deliberately exclude IndexedDB, localStorage and cookies.
            WKWebsiteDataStore.default().removeData(ofTypes: [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache], modifiedSince: .distantPast) {
                call.resolve(["cleared": true])
            }
        }
    }
}

@objc(ScreenshotPlugin)
public class ScreenshotPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScreenshotPlugin"
    public let jsName = "Screenshot"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise)]
    @objc func take(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let view = self.bridge?.webView else { call.reject("No active page"); return }
            let configuration = WKSnapshotConfiguration()
            let top = max(0, min(1, call.getDouble("top") ?? 0))
            let height = max(0.01, min(1 - top, call.getDouble("cropHeight") ?? 1))
            configuration.rect = CGRect(x: 0, y: view.bounds.height * top, width: view.bounds.width, height: view.bounds.height * height)
            configuration.snapshotWidth = NSNumber(value: max(1, min(640, call.getInt("width") ?? 480)))
            view.takeSnapshot(with: configuration) { image, error in
                guard let data = image?.jpegData(compressionQuality: 0.7) else { call.reject(error?.localizedDescription ?? "Snapshot unavailable"); return }
                call.resolve(["dataUrl": "data:image/jpeg;base64," + data.base64EncodedString()])
            }
        }
    }
}
