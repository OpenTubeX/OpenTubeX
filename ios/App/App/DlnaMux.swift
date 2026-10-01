import Foundation

// A bounded reader: URLSession stops receiving while the muxer or TV is busy.
private final class DlnaTrackReader: NSObject, URLSessionDataDelegate {
    private let condition = NSCondition()
    private var chunks = [Data]()
    private var buffered = 0
    private var ended = false
    private var failure: Error?
    private var session: URLSession!
    private var task: URLSessionDataTask!
    private let offset: UInt64

    init(_ media: URLRequest, offset: UInt64 = 0) {
        self.offset = offset
        super.init()
        var request = media
        request.httpMethod = "GET"
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        request.setValue(offset == 0 ? nil : "bytes=\(offset)-", forHTTPHeaderField: "Range")
        if request.value(forHTTPHeaderField: "User-Agent") == nil {
            request.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        task = session.dataTask(with: request)
        task.resume()
    }

    func read(_ count: Int, allowEnd: Bool = false) throws -> Data? {
        var result = Data()
        condition.lock()
        defer { condition.unlock() }
        while result.count < count {
            while chunks.isEmpty && !ended {
                if !condition.wait(until: Date().addingTimeInterval(30)) { throw URLError(.timedOut) }
            }
            if let failure { throw failure }
            if chunks.isEmpty {
                if allowEnd && result.isEmpty { return nil }
                throw URLError(.cannotDecodeContentData)
            }
            let length = min(count - result.count, chunks[0].count)
            result.append(chunks[0].prefix(length))
            chunks[0].removeFirst(length)
            buffered -= length
            if chunks[0].isEmpty { chunks.removeFirst() }
            condition.broadcast()
        }
        return result
    }

    func cancel() {
        condition.lock()
        ended = true
        failure = URLError(.cancelled)
        chunks.removeAll()
        condition.broadcast()
        condition.unlock()
        session.invalidateAndCancel()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let http = response as? HTTPURLResponse
        let valid = offset == 0 ? http?.statusCode == 200 || http?.statusCode == 206
            : http?.statusCode == 206 && (http?.value(forHTTPHeaderField: "Content-Range") ?? "").hasPrefix("bytes \(offset)-")
        if !valid {
            condition.lock()
            failure = URLError(.badServerResponse)
            condition.unlock()
        }
        completionHandler(valid ? .allow : .cancel)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        condition.lock()
        while buffered >= 64 * 1024 && !ended { condition.wait() }
        if !ended { chunks.append(data); buffered += data.count }
        condition.broadcast()
        condition.unlock()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        condition.lock()
        ended = true
        if failure == nil { failure = error }
        condition.broadcast()
        condition.unlock()
        session.finishTasksAndInvalidate()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = request.url, ["http", "https"].contains(url.scheme), url.user == nil, url.password == nil else {
            completionHandler(nil); return
        }
        var next = request
        if response.url?.scheme != url.scheme || response.url?.host != url.host || response.url?.port != url.port {
            for name in ["Authorization", "Cookie", "Host", "Proxy-Authorization", "Origin", "Referer"] {
                next.setValue(nil, forHTTPHeaderField: name)
            }
        }
        completionHandler(next)
    }
}

private struct DlnaBox {
    var data: Data
    var type: String { String(decoding: data[4..<8], as: UTF8.self) }
    func uint(_ offset: Int, _ bytes: Int = 4) throws -> UInt64 {
        guard offset >= 0, offset + bytes <= data.count else { throw URLError(.cannotDecodeContentData) }
        return data[offset..<(offset + bytes)].reduce(0) { ($0 << 8) | UInt64($1) }
    }
    func version() throws -> UInt64 {
        let value = try uint(8, 1)
        guard value <= 1 else { throw URLError(.cannotDecodeContentData) }
        return value
    }
    mutating func clearDuration() throws {
        let extended = try version() == 1
        let offset = type == "tkhd" ? (extended ? 36 : 28) : (extended ? 32 : 24)
        try put(0, at: offset, bytes: extended ? 8 : 4)
    }
    mutating func put(_ value: UInt64, at offset: Int, bytes: Int = 4) throws {
        guard offset >= 0, offset + bytes <= data.count else { throw URLError(.cannotDecodeContentData) }
        for index in 0..<bytes { data[offset + index] = UInt8(truncatingIfNeeded: value >> ((bytes - index - 1) * 8)) }
    }
    func children() throws -> [DlnaBox] {
        var boxes = [DlnaBox]()
        var offset = 8
        while offset < data.count {
            guard offset + 8 <= data.count else { throw URLError(.cannotDecodeContentData) }
            let size = Int(try uint(offset))
            guard size >= 8, offset + size <= data.count else { throw URLError(.cannotDecodeContentData) }
            boxes.append(DlnaBox(data: data.subdata(in: offset..<(offset + size))))
            offset += size
        }
        return boxes
    }
    static func container(_ type: String, _ children: [DlnaBox]) -> DlnaBox {
        let body = children.reduce(into: Data()) { $0.append($1.data) }
        let size = UInt32(body.count + 8)
        return DlnaBox(data: Data([UInt8(truncatingIfNeeded: size >> 24), UInt8(truncatingIfNeeded: size >> 16),
                                  UInt8(truncatingIfNeeded: size >> 8), UInt8(truncatingIfNeeded: size)]) + Data(type.utf8) + body)
    }
}

private final class DlnaTrack {
    var reader: DlnaTrackReader
    let request: URLRequest
    var ftyp: DlnaBox!
    var moov: DlnaBox!
    var pending: DlnaBox?
    private var pendingFragments = [(DlnaBox, DlnaBox, Double)]()
    var timescale: UInt64 = 0
    var index = [(offset: UInt64, time: Double)]()
    private var position: UInt64 = 0

    init(_ request: URLRequest) { self.request = request; reader = DlnaTrackReader(request) }

    func box() throws -> DlnaBox? {
        guard let header = try reader.read(8, allowEnd: true) else { return nil }
        let size = header.prefix(4).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        // YouTube DASH boxes use 32-bit lengths. Reject malformed or unbounded boxes.
        guard size >= 8, size <= 16 * 1024 * 1024 else { throw URLError(.cannotDecodeContentData) }
        let body = try reader.read(Int(size) - 8)!
        position += size
        return DlnaBox(data: header + body)
    }

    func prepare() throws {
        for _ in 0..<16 {
            guard let box = try box() else { throw URLError(.cannotDecodeContentData) }
            switch box.type {
            case "ftyp": ftyp = box
            case "moov":
                moov = box
                guard let trak = try box.children().first(where: { $0.type == "trak" }),
                      let mdia = try trak.children().first(where: { $0.type == "mdia" }),
                      let mdhd = try mdia.children().first(where: { $0.type == "mdhd" }) else { throw URLError(.cannotDecodeContentData) }
                timescale = try mdhd.uint(mdhd.version() == 1 ? 28 : 20)
                guard timescale > 0 else { throw URLError(.cannotDecodeContentData) }
            case "sidx":
                let version = try box.version()
                let scale = try box.uint(16)
                guard scale > 0, version <= 1 else { throw URLError(.cannotDecodeContentData) }
                var time = Double(try box.uint(20, version == 1 ? 8 : 4)) / Double(scale)
                var offset = position + (try box.uint(version == 1 ? 28 : 24, version == 1 ? 8 : 4))
                let count = Int(try box.uint(version == 1 ? 38 : 30, 2))
                for entry in 0..<count {
                    let at = (version == 1 ? 40 : 32) + entry * 12
                    let size = try box.uint(at)
                    guard size & 0x80000000 == 0 else { throw URLError(.cannotDecodeContentData) }
                    index.append((offset, time))
                    offset += size
                    time += Double(try box.uint(at + 4)) / Double(scale)
                }
            case "moof":
                guard moov != nil, ftyp != nil else { throw URLError(.cannotDecodeContentData) }
                pending = box
                return
            default: break
            }
        }
        throw URLError(.cannotDecodeContentData)
    }

    func seek(_ seconds: Double) throws -> Double {
        guard seconds > 0 else { return 0 }
        if let segment = index.last(where: { $0.time <= seconds }), segment.time > 0 {
            reader.cancel()
            reader = DlnaTrackReader(request, offset: segment.offset)
            pending = nil
            position = segment.offset
            return segment.time
        }
        // Some fragmented MP4s omit sidx. Scan fragments with bounded memory
        // instead of silently starting over, keeping the preceding keyframe.
        guard var preceding = try fragment() else { return 0 }
        while let next = try fragment() {
            if next.2 > seconds {
                pendingFragments = [preceding, next]
                return preceding.2
            }
            preceding = next
        }
        pendingFragments = [preceding]
        return preceding.2
    }

    func fragment() throws -> (DlnaBox, DlnaBox, Double)? {
        if !pendingFragments.isEmpty { return pendingFragments.removeFirst() }
        var moof = pending
        pending = nil
        while moof == nil {
            guard let next = try box() else { return nil }
            if next.type == "moof" { moof = next }
        }
        guard let moof, let mdat = try box(), mdat.type == "mdat",
              let traf = try moof.children().first(where: { $0.type == "traf" }),
              let tfdt = try traf.children().first(where: { $0.type == "tfdt" }) else { throw URLError(.cannotDecodeContentData) }
        let time = Double(try tfdt.uint(12, tfdt.version() == 1 ? 8 : 4)) / Double(timescale)
        return (moof, mdat, time)
    }
}

// Copy compressed H.264/AAC samples into one fragmented MP4. No temporary file,
// decoder, or re-encoding is needed; only the current fragment from each track.
final class DlnaMuxer {
    private let lock = NSLock()
    private var tracks = [DlnaTrack]()
    private var cancelled = false

    func cancel() {
        lock.lock()
        cancelled = true
        let readers = tracks.map(\.reader)
        lock.unlock()
        for reader in readers { reader.cancel() }
    }

    private func trimAudio(_ fragment: (DlnaBox, DlnaBox, Double), track: DlnaTrack, base: Double) throws -> (DlnaBox, DlnaBox)? {
        guard fragment.2 < base else { return (fragment.0, fragment.1) }
        var boxes = try fragment.0.children()
        guard let traf = boxes.firstIndex(where: { $0.type == "traf" }),
              let mvex = try track.moov.children().first(where: { $0.type == "mvex" }),
              let trex = try mvex.children().first(where: { $0.type == "trex" }) else { throw URLError(.cannotDecodeContentData) }
        var fields = try boxes[traf].children()
        guard let tfhd = fields.first(where: { $0.type == "tfhd" }),
              let trun = fields.firstIndex(where: { $0.type == "trun" }),
              let tfdt = fields.firstIndex(where: { $0.type == "tfdt" }),
              fields.filter({ $0.type == "trun" }).count == 1 else { throw URLError(.cannotDecodeContentData) }
        let flags = try tfhd.uint(9, 3)
        var at = 16 + (flags & 1 != 0 ? 8 : 0) + (flags & 2 != 0 ? 4 : 0)
        let defaultDuration = try flags & 8 != 0 ? tfhd.uint(at) : trex.uint(20)
        if flags & 8 != 0 { at += 4 }
        let defaultSize = try flags & 16 != 0 ? tfhd.uint(at) : trex.uint(24)
        let runFlags = try fields[trun].uint(9, 3)
        guard runFlags & 1 != 0 else { throw URLError(.cannotDecodeContentData) }
        let entryStart = 16 + 4 + (runFlags & 4 != 0 ? 4 : 0)
        let entrySize = [UInt64(0x100), 0x200, 0x400, 0x800].filter { runFlags & $0 != 0 }.count * 4
        let count = Int(try fields[trun].uint(12))
        var time = try fields[tfdt].uint(12, fields[tfdt].version() == 1 ? 8 : 4)
        let target = UInt64(base * Double(track.timescale))
        var removed = 0
        var removedBytes = 0
        while removed < count {
            let entry = entryStart + removed * entrySize
            let duration = try runFlags & 0x100 != 0 ? fields[trun].uint(entry) : defaultDuration
            let size = try runFlags & 0x200 != 0 ? fields[trun].uint(entry + (runFlags & 0x100 != 0 ? 4 : 0)) : defaultSize
            guard duration > 0 else { throw URLError(.cannotDecodeContentData) }
            if time + duration > target { break }
            time += duration
            removedBytes += Int(size)
            removed += 1
        }
        if removed == count { return nil }
        guard removedBytes <= fragment.1.data.count - 8,
              entryStart + removed * entrySize <= fields[trun].data.count else { throw URLError(.cannotDecodeContentData) }
        fields[trun].data.removeSubrange(entryStart..<(entryStart + removed * entrySize))
        try fields[trun].put(UInt64(fields[trun].data.count), at: 0)
        try fields[trun].put(UInt64(count - removed), at: 12)
        try fields[tfdt].put(time, at: 12, bytes: fields[tfdt].version() == 1 ? 8 : 4)
        boxes[traf] = .container("traf", fields)
        let size = DlnaBox.container("moof", boxes).data.count
        try fields[trun].put(UInt64(size + 8), at: 16)
        boxes[traf] = .container("traf", fields)
        var mdat = fragment.1
        mdat.data.removeSubrange(8..<(8 + removedBytes))
        try mdat.put(UInt64(mdat.data.count), at: 0)
        return (.container("moof", boxes), mdat)
    }

    func stream(video: URLRequest, audio: URLRequest, startSeconds: Double, send: (Data) -> Bool) throws {
        let videoTrack = DlnaTrack(video)
        let audioTrack = DlnaTrack(audio)
        lock.lock()
        tracks = [videoTrack, audioTrack]
        let stopped = cancelled
        lock.unlock()
        defer { cancel() }
        guard !stopped else { throw URLError(.cancelled) }
        try videoTrack.prepare()
        try audioTrack.prepare()
        // Begin at the preceding video segment/keyframe, retaining audio alignment.
        let base = try videoTrack.seek(startSeconds)
        _ = try audioTrack.seek(base)
        var children = try videoTrack.moov.children().filter { !["trak", "mvex"].contains($0.type) }
        if let at = children.firstIndex(where: { $0.type == "mvhd" }) {
            try children[at].clearDuration()
            try children[at].put(3, at: children[at].data.count - 4)
        }
        var defaults = [DlnaBox]()
        for (number, track) in [videoTrack, audioTrack].enumerated() {
            let id = UInt64(number + 1)
            let boxes = try track.moov.children()
            guard let trak = boxes.first(where: { $0.type == "trak" }),
                  let mvex = boxes.first(where: { $0.type == "mvex" }),
                  var trex = try mvex.children().first(where: { $0.type == "trex" }) else { throw URLError(.cannotDecodeContentData) }
            var fields = try trak.children().filter { $0.type != "edts" }
            guard let tkhd = fields.firstIndex(where: { $0.type == "tkhd" }) else { throw URLError(.cannotDecodeContentData) }
            try fields[tkhd].clearDuration()
            try fields[tkhd].put(id, at: fields[tkhd].version() == 1 ? 28 : 20)
            guard let mdia = fields.firstIndex(where: { $0.type == "mdia" }) else { throw URLError(.cannotDecodeContentData) }
            var media = try fields[mdia].children()
            guard let mdhd = media.firstIndex(where: { $0.type == "mdhd" }) else { throw URLError(.cannotDecodeContentData) }
            // The fragment samples define duration. Input movie timescales differ,
            // and a ranged start must not retain either track's full-file duration.
            try media[mdhd].clearDuration()
            fields[mdia] = .container("mdia", media)
            try trex.put(id, at: 12)
            children.append(.container("trak", fields))
            defaults.append(trex)
        }
        children.append(.container("mvex", defaults))
        guard send(Data("HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nAccept-Ranges: none\r\ntransferMode.dlna.org: Streaming\r\nConnection: close\r\n\r\n".utf8)),
              send(videoTrack.ftyp.data), send(DlnaBox.container("moov", children).data) else { throw URLError(.cancelled) }
        var fragments = [try videoTrack.fragment(), try audioTrack.fragment()]
        var sequence: UInt64 = 1
        var outputOffset = UInt64(videoTrack.ftyp.data.count + DlnaBox.container("moov", children).data.count)
        while fragments.contains(where: { $0 != nil }) {
            let index = fragments[0] == nil ? 1 : fragments[1] == nil ? 0 : fragments[0]!.2 <= fragments[1]!.2 ? 0 : 1
            let track = index == 0 ? videoTrack : audioTrack
            let fragment = fragments[index]!
            let media: (DlnaBox, DlnaBox)? = index == 1
                ? try trimAudio(fragment, track: track, base: base) : (fragment.0, fragment.1)
            guard let media else { fragments[index] = try track.fragment(); continue }
            var boxes = try media.0.children()
            for number in boxes.indices {
                if boxes[number].type == "mfhd" { try boxes[number].put(sequence, at: 12) }
                if boxes[number].type == "traf" {
                    var fields = try boxes[number].children()
                    for field in fields.indices {
                        if fields[field].type == "tfhd" {
                            let flags = try fields[field].uint(9, 3)
                            try fields[field].put(UInt64(index + 1), at: 12)
                            if flags & 1 != 0 { try fields[field].put(outputOffset, at: 16, bytes: 8) }
                            else { try fields[field].put(flags | 0x020000, at: 9, bytes: 3) }
                        }
                        if fields[field].type == "tfdt" {
                            // With a ranged start, keep timestamps relative to the video keyframe.
                            let bytes = try fields[field].version() == 1 ? 8 : 4
                            let time = try fields[field].uint(12, bytes)
                            let shift = UInt64(base * Double(track.timescale))
                            // Audio samples before the selected keyframe have been trimmed.
                            try fields[field].put(time > shift ? time - shift : 0, at: 12, bytes: bytes)
                        }
                    }
                    boxes[number] = .container("traf", fields)
                }
            }
            let moof = DlnaBox.container("moof", boxes)
            guard send(moof.data), send(media.1.data) else { throw URLError(.cancelled) }
            outputOffset += UInt64(moof.data.count + media.1.data.count)
            sequence += 1
            fragments[index] = try track.fragment()
        }
    }
}
