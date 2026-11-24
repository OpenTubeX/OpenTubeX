import XCTest
import Capacitor
import AVFoundation
import WebKit
import MediaPlayer
import Network
import AVKit
@testable import App

extension AppTests {
    func testStorageUsageDoesNotDoubleCountCache() async throws {
        try await openApplication()
        func usage() async throws -> [String: Double] {
            let value = try await webView.callPageScript("return await Capacitor.Plugins.IOSStorage.getUsage()")
            return try XCTUnwrap(value as? [String: Double])
        }
        let before = try await usage()
        let directory = try XCTUnwrap(FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first)
        let file = directory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: file) }
        let size = 8 * 1024 * 1024
        try Data(repeating: 42, count: size).write(to: file)
        let after = try await usage()
        XCTAssertEqual(try XCTUnwrap(after["cacheBytes"]) - XCTUnwrap(before["cacheBytes"]), Double(size), accuracy: 1024 * 1024)
        XCTAssertEqual(try XCTUnwrap(after["appDataBytes"]) - XCTUnwrap(before["appDataBytes"]), 0, accuracy: 1024 * 1024)
    }

    func testLibraryDatabaseStoresTypedValuesLargeRowsAndRollsBack() async throws {
        try await openApplication()
        let result = try await webView.callPageScript("""
            const name = 'apptests'
            const library = Capacitor.Plugins.LibraryDatabase
            const run = (statements, transaction = false) => library.execute({ name, statements, transaction }).then(result => result.results)
            await library.drop({ name })
            await run([['CREATE TABLE docs (id PRIMARY KEY NOT NULL, data TEXT NOT NULL) WITHOUT ROWID']], true)
            // Large rows such as sync snapshots, and the non-NUL prefix of non-scalar IDs.
            const large = JSON.stringify({ value: 'x'.repeat(5 * 1024 * 1024) })
            await run([
                ['INSERT INTO docs VALUES (?, ?)', ['text', large]],
                ['INSERT INTO docs VALUES (?, ?)', [5, '{"n":1.5}']],
                ['INSERT INTO docs VALUES (?, ?)', [1700000000000, '{}']],
                ['INSERT INTO docs VALUES (?, ?)', ['\\u0001{"id":null}', '{}']],
            ], true)
            let rolledBack = false
            try {
                await run([['INSERT INTO docs VALUES (?, ?)', ['added', '{}']], ['INSERT INTO docs VALUES (?, ?)', [5, 'duplicate']]], true)
            } catch {
                rolledBack = true
            }
            const [summary, [[text]]] = await run([
                ["SELECT id, json_extract(data, '$.n') FROM docs ORDER BY typeof(id), id"],
                ['SELECT data FROM docs WHERE id = ?', ['text']],
            ])
            await library.drop({ name })
            return JSON.stringify({ rolledBack, summary, largeRow: text === large })
            """) as? String
        XCTAssertEqual(result, #"{"rolledBack":true,"summary":[[5,1.5],[1700000000000,null],["\u0001{\"id\":null}",null],["text",null]],"largeRow":true}"#)
    }

    func testFilesystemTemporaryFileRoundTrip() async throws {
        try await openApplication()
        let result = try await webView.callPageScript("""
            const filesystem = Capacitor.Plugins.Filesystem
            const options = { path: `filesystem-test-${crypto.randomUUID()}.txt`, directory: 'TEMPORARY' }
            const data = 'Temporary file: Grüß dich 👋'
            await filesystem.writeFile({ ...options, data, encoding: 'utf8' })
            try {
                const info = await filesystem.stat(options)
                const file = await filesystem.readFile({ ...options, encoding: 'utf8' })
                return file.data === data && info.type === 'file' && info.size === new TextEncoder().encode(data).length
            } finally {
                await filesystem.deleteFile(options)
            }
            """) as? Bool
        XCTAssertEqual(result, true)
    }

    func testUserRecordsSurviveReloadAndCacheClear() async throws {
        try await openApplication()
        let id = "ios-test-" + UUID().uuidString
        let videoId = String(UUID().uuidString.prefix(11))
        let arguments: [String: Any] = ["id": id, "videoId": videoId]
        _ = try await webView.callPageScript("""
        await testRouter.push('/subscriptions');
        const video = {videoId, title: 'iOS Grüße 日本語', author: 'Fixture', authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
            published: Date.now(), lengthSeconds: 100, watchProgress: 37, isLive: false, isWatched: false, timeWatched: Date.now(), type: 'video'};
        await testStore.dispatch('createProfile', {_id: id, name: 'iOS Grüße 日本語', bgColor: '#112233',
            subscriptions: [{id: video.authorId, name: 'Fixture channel', thumbnail: ''}]});
        await testStore.dispatch('addPlaylist', {_id: id, playlistName: 'iOS Grüße 日本語', description: 'Persistence fixture', videos: [video]});
        await testStore.dispatch('updateHistory', video);
        await testStore.dispatch('updateSearchHistoryEntry', {_id: id, query: 'iOS Grüße 日本語 ' + id, lastUpdatedAt: Date.now()});
        localStorage.setItem(id, 'retained');
        await Capacitor.Plugins.IOSStorage.clearCache();
        """, arguments: arguments)
        _ = try await evaluate("window.iosRecordReloadMarker = true")
        try webView.reload()
        try await wait("window.iosRecordReloadMarker !== true")
        try await openApplication()
        let restored = try await webView.callPageScript("""
        await Promise.all(['grabAllProfiles', 'grabAllPlaylists', 'grabHistory', 'grabSearchHistoryEntries'].map(action => testStore.dispatch(action)));
        const profile = testStore.getters.getProfileList.find(profile => profile._id === id);
        const playlist = testStore.getters.getPlaylist(id);
        const history = testStore.getters.getHistoryCacheById[videoId];
        return {profile: profile?.name, subscription: profile?.subscriptions[0]?.id,
            playlist: playlist?.playlistName, video: playlist?.videos[0]?.videoId,
            progress: history?.watchProgress, title: history?.title,
            search: testStore.getters.getSearchHistoryEntries.some(entry => entry._id === id), local: localStorage.getItem(id)};
        """, arguments: arguments) as? [String: Any]
        XCTAssertEqual(restored?["profile"] as? String, "iOS Grüße 日本語")
        XCTAssertEqual(restored?["subscription"] as? String, "UCaaaaaaaaaaaaaaaaaaaaaa")
        XCTAssertEqual(restored?["playlist"] as? String, "iOS Grüße 日本語")
        XCTAssertEqual(restored?["video"] as? String, videoId)
        XCTAssertEqual(restored?["progress"] as? Int, 37)
        XCTAssertEqual(restored?["title"] as? String, "iOS Grüße 日本語")
        XCTAssertEqual(restored?["search"] as? Bool, true)
        XCTAssertEqual(restored?["local"] as? String, "retained")
        _ = try await webView.callPageScript("""
        await testStore.dispatch('removeProfile', id);
        await testStore.dispatch('removePlaylist', id);
        await testStore.dispatch('removeFromHistory', videoId);
        await testStore.dispatch('removeSearchHistoryEntry', id);
        localStorage.removeItem(id);
        """, arguments: arguments)
    }

    func testFilePickerRejectsOtherPresentedDialog() async throws {
        try await openApplication()
        let controller = try XCTUnwrap(webView.window?.rootViewController as? OpenTubeXViewController)
        let dialog = UIAlertController(title: "Native modal fixture", message: "Another dialog owns presentation", preferredStyle: .alert)
        try await waitForNative { controller.presentedViewController == nil }
        controller.present(dialog, animated: false)
        try await waitForNative { dialog.presentingViewController != nil && !dialog.isBeingPresented }
        let result = try await webView.callPageScript("""
        return await Promise.race([
            Capacitor.Plugins.IOSStorage.saveFile({fileName: 'modal-test.json', data: btoa('{}')}).then(() => 'resolved').catch(() => 'rejected'),
            new Promise(resolve => setTimeout(() => resolve('pending'), 1000))
        ]);
        """) as? String
        // Clean up the pending fixture too if the rejection regression fails.
        if result == "pending" {
            (controller.bridge?.plugin(withName: "IOSStorage") as? IOSStoragePlugin)?.documentPickerWasCancelled(UIDocumentPickerViewController(forOpeningContentTypes: []))
        }
        try await dismiss(dialog)
        XCTAssertEqual(result, "rejected", "File export must reject instead of hanging behind a different native dialog")
        let files = try XCTUnwrap(FileManager.default.enumerator(at: FileManager.default.temporaryDirectory, includingPropertiesForKeys: nil))
        XCTAssertFalse(files.compactMap { $0 as? URL }.contains { $0.lastPathComponent == "modal-test.json" })
        _ = try await evaluate("window.iosModalRetry = 'pending'; Capacitor.Plugins.IOSStorage.chooseDirectory().then(result => iosModalRetry = result.path); true")
        try await waitForNative { controller.presentedViewController != nil }
        let picker = try XCTUnwrap(controller.presentedViewController as? UIDocumentPickerViewController)
        picker.delegate?.documentPickerWasCancelled?(picker)
        try await dismiss(picker)
        try await wait("iosModalRetry === null")
    }

    func testFileExportCancellation() async throws {
        try await openApplication()
        _ = try await evaluate("window.iosFileResult = null; Capacitor.Plugins.IOSStorage.saveFile({fileName: 'opentubex-test.json', data: btoa('{}')}).then(result => window.iosFileResult = result); true")
        let controller = try XCTUnwrap(webView.window?.rootViewController)
        try await waitForNative { controller.presentedViewController != nil }
        let picker = try XCTUnwrap(controller.presentedViewController as? UIDocumentPickerViewController)
        let files = try XCTUnwrap(FileManager.default.enumerator(at: FileManager.default.temporaryDirectory, includingPropertiesForKeys: nil))
        let exported = try XCTUnwrap(files.compactMap { $0 as? URL }.first { $0.lastPathComponent == "opentubex-test.json" })
        XCTAssertEqual(try String(contentsOf: exported, encoding: .utf8), "{}")
        picker.delegate?.documentPickerWasCancelled?(picker)
        try await dismiss(picker)
        try await wait("window.iosFileResult?.saved === false")
        XCTAssertFalse(FileManager.default.fileExists(atPath: exported.path))
    }

    private func openDataSettings() async throws {
        try await openApplication()
        _ = try await webView.callPageScript("for (const video of document.querySelectorAll('video')) video.pause(); await testRouter.push('/subscriptions'); testStore.commit('setSettingsWindowSection', 'data'); await testStore.dispatch('showSettingsWindow')")
        try await wait("Array.from(document.querySelectorAll('.settingsWindow button')).some(button => button.textContent.trim() === 'Import Settings')")
    }

    private func importFixture(_ data: Data, name: String, action: String) async throws {
        // Exercise WebKit's file-input path and the real importer. Native picker
        // presentation and cancellation are covered separately.
        _ = try await webView.callPageScript("""
        const originalClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () {
            if (this.type !== 'file') return originalClick.call(this);
            HTMLInputElement.prototype.click = originalClick;
            const transfer = new DataTransfer();
            transfer.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], name));
            this.files = transfer.files;
            this.dispatchEvent(new Event('change'));
            window.dispatchEvent(new Event('focus'));
        };
        try {
            const button = Array.from(document.querySelectorAll('.settingsWindow button')).find(button => button.textContent.trim() === action);
            if (!button) throw new Error('Import button missing: ' + action);
            button.click();
        } finally {
            HTMLInputElement.prototype.click = originalClick;
        }
        """, arguments: ["data": data.base64EncodedString(), "name": name, "action": action])
    }

    func testSettingsFileImportValidation() async throws {
        try await openDataSettings()
        let original = try await evaluate("testStore.getters.getRememberHistory") as? Bool ?? true
        do {
            _ = try await webView.callPageScript("await testStore.dispatch('updateRememberHistory', true)")
            let mixed = "\n{broken\n{\"_id\":\"rememberHistory\",\"value\":false}\nnull\n"
            try await importFixture(Data(mixed.utf8), name: "settings.db", action: "Import Settings")
            try await wait("testStore.getters.getRememberHistory === false && Array.from(document.querySelectorAll('.toast')).some(toast => toast.textContent.includes('Invalid JSON at row 2'))")
            try await importFixture(Data("\u{FEFF}{\"rememberHistory\":true}".utf8), name: "settings.json", action: "Import Settings")
            try await wait("testStore.getters.getRememberHistory === true")
            try await wait("!Array.from(document.querySelectorAll('.toast')).some(toast => toast.textContent.includes('All settings have been successfully imported'))")
            try await importFixture(Data("{\"_id\":\"rememberHistory\"}".utf8), name: "invalid.db", action: "Import Settings")
            try await wait("Array.from(document.querySelectorAll('.toast')).some(toast => toast.textContent.includes('Unable to read file'))")
            let unchanged = try await evaluate("testStore.getters.getRememberHistory === true && !Array.from(document.querySelectorAll('.toast')).some(toast => toast.textContent.includes('All settings have been successfully imported'))") as? Bool
            XCTAssertEqual(unchanged, true)
        } catch {
            _ = try? await webView.callPageScript("await testStore.dispatch('updateRememberHistory', original); await testStore.dispatch('hideSettingsWindow')", arguments: ["original": original])
            throw error
        }
        _ = try await webView.callPageScript("await testStore.dispatch('updateRememberHistory', original); await testStore.dispatch('hideSettingsWindow')", arguments: ["original": original])
    }

    func testUnifiedBackupNativeExportAndWebKitImport() async throws {
        try await openDataSettings()
        let id = "ios-backup-" + UUID().uuidString
        let videoId = String(UUID().uuidString.prefix(11))
        let originalHistorySetting = try await evaluate("testStore.getters.getRememberHistory") as? Bool ?? true
        let arguments: [String: Any] = ["id": id, "videoId": videoId]
        func cleanup() async {
            _ = try? await webView.callPageScript("""
            await testStore.dispatch('removeProfile', id);
            await testStore.dispatch('removePlaylist', id);
            await testStore.dispatch('removeFromHistory', videoId);
            for (const entry of testStore.getters.getSearchHistoryEntries.filter(entry => entry.query === 'Backup Grüße 日本語 ' + id)) {
                await testStore.dispatch('removeSearchHistoryEntry', entry._id);
            }
            await testStore.dispatch('hideSettingsWindow');
            """, arguments: arguments)
            _ = try? await webView.callPageScript("await testStore.dispatch('updateRememberHistory', original)", arguments: ["original": originalHistorySetting])
        }
        do {
            _ = try await webView.callPageScript("""
            const video = {videoId, title: 'Backup Grüße 日本語', author: 'Fixture', authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
                published: Date.now(), lengthSeconds: 100, watchProgress: 37.25, isLive: false, isWatched: false, timeWatched: Date.now(), type: 'video'};
            await testStore.dispatch('createProfile', {_id: id, name: 'Backup Grüße 日本語', bgColor: '#112233', subscriptions: [{id: video.authorId, name: 'Fixture channel', thumbnail: ''}]});
            await testStore.dispatch('addPlaylist', {_id: id, playlistName: 'Backup Grüße 日本語', description: 'Native backup fixture', videos: [video]});
            await testStore.dispatch('updateHistory', video);
            await testStore.dispatch('updateSearchHistoryEntry', {_id: id, query: 'Backup Grüße 日本語 ' + id, lastUpdatedAt: Date.now()});
            await testStore.dispatch('updateRememberHistory', false);
            Array.from(document.querySelectorAll('.settingsWindow button')).find(button => button.textContent.trim() === 'Export backup').click();
            """, arguments: arguments)
            try await wait("Array.from(document.querySelectorAll('.settingsSubpageContent button')).some(button => button.textContent.trim() === 'Export selected data' && !button.disabled)")
            _ = try await evaluate("Array.from(document.querySelectorAll('.settingsSubpageContent button')).find(button => button.textContent.trim() === 'Export selected data').click(); true")
            let controller = try XCTUnwrap(webView.window?.rootViewController)
            try await waitForNative { controller.presentedViewController != nil }
            let picker = try XCTUnwrap(controller.presentedViewController as? UIDocumentPickerViewController)
            let files = try XCTUnwrap(FileManager.default.enumerator(at: FileManager.default.temporaryDirectory, includingPropertiesForKeys: nil))
            let exported = try XCTUnwrap(files.compactMap { $0 as? URL }.first { $0.lastPathComponent.hasPrefix("opentubex-backup-") && $0.pathExtension == "zip" })
            let archive = try Data(contentsOf: exported)
            XCTAssertEqual(Array(archive.prefix(4)), [0x50, 0x4b, 0x03, 0x04])
            picker.delegate?.documentPickerWasCancelled?(picker)
            try await dismiss(picker)
            XCTAssertFalse(FileManager.default.fileExists(atPath: exported.path))
            _ = try await evaluate("document.querySelector('.settingsWindow .settingsBackButton').click(); true")
            try await wait("!document.querySelector('.settingsSubpageContent')")
            _ = try await webView.callPageScript("""
            await testStore.dispatch('removeProfile', id);
            await testStore.dispatch('removePlaylist', id);
            await testStore.dispatch('removeFromHistory', videoId);
            await testStore.dispatch('removeSearchHistoryEntry', id);
            await testStore.dispatch('updateRememberHistory', true);
            """, arguments: arguments)
            let removed = try await webView.callPageScript("""
            return !testStore.getters.getProfileList.some(profile => profile._id === id)
                && !testStore.getters.getPlaylist(id)
                && !testStore.getters.getHistoryCacheById[videoId]
                && !testStore.getters.getSearchHistoryEntries.some(entry => entry.query === 'Backup Grüße 日本語 ' + id)
                && testStore.getters.getRememberHistory === true;
            """, arguments: arguments) as? Bool
            XCTAssertEqual(removed, true, "Fixtures must be absent before testing restoration")
            try await importFixture(archive, name: "native-backup.zip", action: "Import backup")
            try await wait("Array.from(document.querySelectorAll('.settingsSubpageContent button')).some(button => button.textContent.trim() === 'Import selected data')")
            _ = try await evaluate("Array.from(document.querySelectorAll('.settingsSubpageContent button')).find(button => button.textContent.trim() === 'Import selected data').click(); true")
            try await wait("Array.from(document.querySelectorAll('.toast')).some(toast => toast.textContent.includes('Backup imported successfully'))")
            let restored = try await webView.callPageScript("""
            const profile = testStore.getters.getProfileList.find(profile => profile._id === id);
            return {profile: profile?.name, subscription: profile?.subscriptions[0]?.id,
                playlist: testStore.getters.getPlaylist(id)?.videos[0]?.videoId,
                progress: testStore.getters.getHistoryCacheById[videoId]?.watchProgress,
                search: testStore.getters.getSearchHistoryEntries.some(entry => entry.query === 'Backup Grüße 日本語 ' + id),
                rememberHistory: testStore.getters.getRememberHistory};
            """, arguments: arguments) as? [String: Any]
            XCTAssertEqual(restored?["profile"] as? String, "Backup Grüße 日本語")
            XCTAssertEqual(restored?["subscription"] as? String, "UCaaaaaaaaaaaaaaaaaaaaaa")
            XCTAssertEqual(restored?["playlist"] as? String, videoId)
            XCTAssertEqual(restored?["progress"] as? Double, 37.25)
            XCTAssertEqual(restored?["search"] as? Bool, true)
            XCTAssertEqual(restored?["rememberHistory"] as? Bool, false)
        } catch {
            await cleanup()
            throw error
        }
        await cleanup()
    }

    func testLargeFileExportAndCleanup() async throws {
        try await openApplication()
        _ = try await webView.callPageScript("""
        const blob = new Blob(['Grüße ', 'x'.repeat(16 * 1024 * 1024)], {type: 'text/plain;charset=utf-8'});
        const data = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob);
        });
        window.iosLargeFile = 'pending';
        Capacitor.Plugins.IOSStorage.saveFile({fileName: 'ios-large-export.txt', data}).then(result => iosLargeFile = result.saved).catch(error => iosLargeFile = error.message);
        """)
        let controller = try XCTUnwrap(webView.window?.rootViewController)
        try await waitForNative { controller.presentedViewController != nil }
        let picker = try XCTUnwrap(controller.presentedViewController as? UIDocumentPickerViewController)
        let files = try XCTUnwrap(FileManager.default.enumerator(at: FileManager.default.temporaryDirectory, includingPropertiesForKeys: nil))
        let exported = try XCTUnwrap(files.compactMap { $0 as? URL }.first { $0.lastPathComponent == "ios-large-export.txt" })
        let attributes = try FileManager.default.attributesOfItem(atPath: exported.path)
        XCTAssertEqual((attributes[.size] as? NSNumber)?.intValue, 16 * 1024 * 1024 + 8)
        let handle = try FileHandle(forReadingFrom: exported)
        XCTAssertEqual(String(data: try XCTUnwrap(try handle.read(upToCount: 8)), encoding: .utf8), "Grüße ")
        try handle.close()
        picker.delegate?.documentPickerWasCancelled?(picker)
        try await dismiss(picker)
        try await wait("iosLargeFile === false")
        XCTAssertFalse(FileManager.default.fileExists(atPath: exported.path))
    }

    func testFileValidationAndConcurrentPicker() async throws {
        try await openApplication()
        let errors = try await webView.callPageScript("""
        const inputs = [
            { fileName: '../outside.json', data: btoa('{}') },
            { fileName: '..', data: btoa('{}') },
            { fileName: 'invalid.json', data: 'not base64!' },
            { fileName: 'denied.json', data: btoa('{}'), directory: '{}' }
        ];
        return await Promise.all(inputs.map(async input => {
            try { await Capacitor.Plugins.IOSStorage.saveFile(input); return false; }
            catch { return true; }
        }));
        """) as? [Bool]
        XCTAssertEqual(errors, [true, true, true, true])
        _ = try await evaluate("window.iosDirectoryResult = 'pending'; Capacitor.Plugins.IOSStorage.chooseDirectory().then(result => iosDirectoryResult = result.path); true")
        let controller = try XCTUnwrap(webView.window?.rootViewController)
        try await waitForNative { controller.presentedViewController != nil }
        let picker = try XCTUnwrap(controller.presentedViewController as? UIDocumentPickerViewController)
        let busy = try await webView.callPageScript("try { await Capacitor.Plugins.IOSStorage.saveFile({fileName: 'busy.json', data: btoa('{}')}); return false; } catch (error) { return error.message.includes('already open'); }") as? Bool
        XCTAssertEqual(busy, true)
        XCTAssertTrue(controller.presentedViewController === picker)
        picker.delegate?.documentPickerWasCancelled?(picker)
        try await dismiss(picker)
        try await wait("iosDirectoryResult === null")
    }

    func testSharePresentationAndCancellation() async throws {
        try await openApplication()
        _ = try await evaluate("window.iosShareResult = 'pending'; Capacitor.Plugins.Share.share({title: 'OpenTubeX test', text: 'Native share test', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw'}).then(() => iosShareResult = 'shared').catch(error => iosShareResult = error.message); true")
        let controller = try XCTUnwrap(webView.window?.rootViewController)
        try await waitForNative { controller.presentedViewController != nil }
        let share = try XCTUnwrap(controller.presentedViewController as? UIActivityViewController)
        if UIDevice.current.userInterfaceIdiom == .pad {
            XCTAssertNotNil(share.popoverPresentationController?.sourceView)
        }
        share.completionWithItemsHandler?(nil, false, nil, nil)
        try await dismiss(share)
        try await wait("iosShareResult === 'Share canceled'")
    }
}
