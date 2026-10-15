import Capacitor
import Foundation
import SQLite3

private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

private struct LibraryDatabaseError: LocalizedError {
    let errorDescription: String?
}

/// One library datastore in the system SQLite, outside WebView storage.
final class LibraryDatabase {
    private let url: URL
    private var db: OpaquePointer?
    private var statements: [String: OpaquePointer] = [:]

    init(directory: URL, name: String) throws {
        guard !name.isEmpty, name.range(of: "^[a-z0-9-]+$", options: .regularExpression) != nil else {
            throw LibraryDatabaseError(errorDescription: "Invalid library name")
        }
        url = directory.appendingPathComponent("library-\(name).sqlite")
    }

    static func directory() throws -> URL {
        let directory = try FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("Library", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private func failure() -> LibraryDatabaseError {
        LibraryDatabaseError(errorDescription: db.map { String(cString: sqlite3_errmsg($0)) } ?? "Unable to open the library")
    }

    private func open() throws {
        guard db == nil else { return }
        var handle: OpaquePointer?
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "Unable to open the library"
            sqlite3_close(handle)
            throw LibraryDatabaseError(errorDescription: message)
        }
        db = handle
        try exec("PRAGMA busy_timeout = 5000")
        // Takes effect only before the first table exists. Switching to the
        // write-ahead log rewrites and syncs this header, so skip its own sync.
        try exec("PRAGMA synchronous = OFF")
        try exec("PRAGMA auto_vacuum = INCREMENTAL")
        // Every committed write survives power loss.
        try exec("PRAGMA synchronous = FULL")
        try exec("PRAGMA journal_mode = WAL")
    }

    private func exec(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw failure() }
    }

    /// Runs statements in order; with `transaction`, all of them commit or none does.
    func execute(_ list: [Any], transaction: Bool) throws -> [Any] {
        try open()
        if transaction { try exec("BEGIN IMMEDIATE") }
        do {
            var results: [Any] = []
            for entry in list {
                guard let statement = entry as? [Any], let sql = statement.first as? String else {
                    throw LibraryDatabaseError(errorDescription: "Invalid library statement")
                }
                var params: [Any] = []
                if statement.count > 1 {
                    guard let values = statement[1] as? [Any] else {
                        throw LibraryDatabaseError(errorDescription: "Invalid library statement parameters")
                    }
                    params = values
                }
                results.append(try run(sql, params: params))
            }
            if transaction { try exec("COMMIT") }
            return results
        } catch {
            if transaction && sqlite3_get_autocommit(db) == 0 { _ = sqlite3_exec(db, "ROLLBACK", nil, nil, nil) }
            throw error
        }
    }

    private func run(_ sql: String, params: [Any]) throws -> [Any] {
        var statement = statements[sql]
        if statement == nil {
            guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw failure() }
            statements[sql] = statement
        }
        defer {
            sqlite3_reset(statement)
            sqlite3_clear_bindings(statement)
        }
        for (offset, value) in params.enumerated() {
            try bind(statement, Int32(offset + 1), value)
        }
        var rows: [Any] = []
        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { break }
            guard result == SQLITE_ROW else { throw failure() }
            var row: [Any] = []
            for column in 0..<sqlite3_column_count(statement) {
                switch sqlite3_column_type(statement, column) {
                case SQLITE_INTEGER: row.append(NSNumber(value: sqlite3_column_int64(statement, column)))
                case SQLITE_FLOAT: row.append(NSNumber(value: sqlite3_column_double(statement, column)))
                case SQLITE_TEXT:
                    let bytes = sqlite3_column_text(statement, column)
                    let count = Int(sqlite3_column_bytes(statement, column))
                    row.append(bytes.map { String(decoding: UnsafeBufferPointer(start: $0, count: count), as: UTF8.self) } ?? "")
                case SQLITE_NULL: row.append(NSNull())
                default: throw LibraryDatabaseError(errorDescription: "Unsupported library value")
                }
            }
            rows.append(row)
        }
        return rows
    }

    private func bind(_ statement: OpaquePointer?, _ index: Int32, _ value: Any) throws {
        let result: Int32
        switch value {
        case is NSNull:
            result = sqlite3_bind_null(statement, index)
        case let text as String:
            // An explicit byte length keeps empty strings and embedded NULs intact.
            result = text.withCString { sqlite3_bind_text(statement, index, $0, Int32(text.utf8.count), transient) }
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                result = sqlite3_bind_int64(statement, index, number.boolValue ? 1 : 0)
            } else if CFNumberIsFloatType(number) {
                result = sqlite3_bind_double(statement, index, number.doubleValue)
            } else {
                result = sqlite3_bind_int64(statement, index, number.int64Value)
            }
        default:
            throw LibraryDatabaseError(errorDescription: "Unsupported library parameter")
        }
        guard result == SQLITE_OK else { throw failure() }
    }

    /// Deletes the database files.
    func drop() throws {
        close()
        for suffix in ["", "-wal", "-shm", "-journal"] {
            do {
                try FileManager.default.removeItem(at: URL(fileURLWithPath: url.path + suffix))
            } catch CocoaError.fileNoSuchFile {
                // Already absent.
            }
        }
    }

    func close() {
        for statement in statements.values { sqlite3_finalize(statement) }
        statements.removeAll()
        if let db { sqlite3_close_v2(db) }
        db = nil
    }

    deinit { close() }
}

/// Native SQLite for the library datastores.
@objc(LibraryDatabasePlugin)
public class LibraryDatabasePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LibraryDatabasePlugin"
    public let jsName = "LibraryDatabase"
    public let pluginMethods: [CAPPluginMethod] = ["execute", "drop"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }
    // One queue runs every statement in order, off the bridge's thread.
    private let queue = DispatchQueue(label: "org.opentubex.library-database")
    private var databases: [String: LibraryDatabase] = [:]

    private func database(_ name: String?) throws -> LibraryDatabase {
        guard let name else { throw LibraryDatabaseError(errorDescription: "Missing library name") }
        if let database = databases[name] { return database }
        let database = try LibraryDatabase(directory: try LibraryDatabase.directory(), name: name)
        databases[name] = database
        return database
    }

    @objc func execute(_ call: CAPPluginCall) {
        let name = call.getString("name")
        let statements: [Any]? = call.getArray("statements")
        let transaction = call.getBool("transaction") ?? false
        queue.async {
            do {
                guard let statements else { throw LibraryDatabaseError(errorDescription: "Missing statements") }
                let results = try self.database(name).execute(statements, transaction: transaction)
                call.resolve(["results": results])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func drop(_ call: CAPPluginCall) {
        let name = call.getString("name")
        queue.async {
            do {
                try self.database(name).drop()
                if let name { self.databases.removeValue(forKey: name) }
                call.resolve()
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }
}
