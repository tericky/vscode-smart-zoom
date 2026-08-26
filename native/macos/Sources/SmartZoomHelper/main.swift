import AppKit
import CoreGraphics
import Darwin
import Foundation

private struct BoundsResponse: Encodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    init(_ bounds: CGRect) {
        x = bounds.origin.x
        y = bounds.origin.y
        width = bounds.width
        height = bounds.height
    }
}

private struct DisplayResponse: Encodable {
    let id: String
    let name: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let scaleFactor: Double

    init(id: String, name: String, bounds: CGRect, scaleFactor: Double) {
        self.id = id
        self.name = name
        x = bounds.origin.x
        y = bounds.origin.y
        width = bounds.width
        height = bounds.height
        self.scaleFactor = scaleFactor
    }
}

private struct SuccessData: Encodable {
    let window: BoundsResponse
    let display: DisplayResponse
}

private struct SuccessResponse: Encodable {
    let ok = true
    let data: SuccessData
    let requestId: String?

    init(data: SuccessData, requestId: String? = nil) {
        self.data = data
        self.requestId = requestId
    }
}

private struct ErrorResponse: Encodable {
    let ok = false
    let error: String
    let requestId: String?

    init(error: String, requestId: String? = nil) {
        self.error = error
        self.requestId = requestId
    }
}

private struct EventResponse: Encodable {
    let ok = true
    let event: String
    let requestId: String?
}

private func parentPID(of pid: Int32) -> Int32? {
    var processInfo = proc_bsdinfo()
    let result = proc_pidinfo(
        pid,
        PROC_PIDTBSDINFO,
        0,
        &processInfo,
        Int32(MemoryLayout<proc_bsdinfo>.size)
    )
    guard result == MemoryLayout<proc_bsdinfo>.size, processInfo.pbi_ppid > 0 else {
        return nil
    }

    return Int32(processInfo.pbi_ppid)
}

private func processFamily(startingAt pid: Int32) -> [Int32] {
    var family: [Int32] = []
    var seen = Set<Int32>()
    var current: Int32? = pid

    while let processID = current, processID > 1, seen.insert(processID).inserted {
        family.append(processID)
        current = parentPID(of: processID)
    }

    return family
}

private func windowCandidates() -> [WindowCandidate] {
    guard let windowInfo = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements],
        kCGNullWindowID
    ) as? [[String: Any]] else {
        return []
    }

    return windowInfo.enumerated().compactMap { listOrder, info -> WindowCandidate? in
        guard
            let ownerPID = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
            let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue,
            layer == 0,
            let boundsDictionary = info[kCGWindowBounds as String] as? [String: Any],
            let bounds = CGRect(
                dictionaryRepresentation: boundsDictionary as CFDictionary
            ),
            bounds.width > 0,
            bounds.height > 0
        else {
            return nil
        }

        return WindowCandidate(
            ownerPID: ownerPID,
            bounds: bounds,
            listOrder: listOrder,
            title: info[kCGWindowName as String] as? String,
            ownerName: info[kCGWindowOwnerName as String] as? String
        )
    }
}

private func activeDisplays() -> [DisplayCandidate] {
    var displayCount: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &displayCount) == .success, displayCount > 0 else {
        return []
    }

    var displayIDs = Array(repeating: CGDirectDisplayID(), count: Int(displayCount))
    guard CGGetActiveDisplayList(displayCount, &displayIDs, &displayCount) == .success else {
        return []
    }

    return displayIDs.prefix(Int(displayCount)).map {
        DisplayCandidate(id: $0, bounds: CGDisplayBounds($0))
    }
}

private func screen(for displayID: CGDirectDisplayID) -> NSScreen? {
    NSScreen.screens.first {
        let key = NSDeviceDescriptionKey("NSScreenNumber")
        return ($0.deviceDescription[key] as? NSNumber)?.uint32Value == displayID
    }
}

private func persistentID(for displayID: CGDirectDisplayID) -> String? {
    guard let displayUUID = CGDisplayCreateUUIDFromDisplayID(displayID)?.takeRetainedValue() else {
        return nil
    }
    guard let displayUUIDString = CFUUIDCreateString(nil, displayUUID) else {
        return nil
    }

    return displayUUIDString as String
}

private let outputLock = NSLock()

private final class WatchState: @unchecked Sendable {
    let lock = NSLock()
    var request: HelperRequest?
    var lastDisplayID: String?
    var started = false
}

private let watchState = WatchState()

private func resolve(_ request: HelperRequest) throws -> SuccessResponse {
    guard let pid = request.pid, pid > 0 else {
        throw HelperError.invalidPID
    }

    let family = processFamily(startingAt: pid)
    let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
    guard let window = selectWindow(
        from: windowCandidates(),
        eligiblePIDs: family,
        frontmostPID: frontmostPID,
        titleHint: request.titleHint
    ) else {
        throw HelperError.windowNotFound
    }

    guard let display = displayContainingWindowCenter(
        window.bounds,
        displays: activeDisplays()
    ) else {
        throw HelperError.displayNotFound
    }
    let displayID = persistentID(for: display.id) ?? "cg-\(display.id)"

    let matchingScreen = screen(for: display.id)
    let displayResponse = DisplayResponse(
        id: displayID,
        name: matchingScreen?.localizedName ?? "Unknown Display",
        bounds: display.bounds,
        scaleFactor: Double(matchingScreen?.backingScaleFactor ?? 1)
    )

    return SuccessResponse(
        data: SuccessData(
            window: BoundsResponse(window.bounds),
            display: displayResponse
        ),
        requestId: request.requestId
    )
}

private func writeJSON<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]

    guard let data = try? encoder.encode(value) else {
        outputLock.lock()
        FileHandle.standardOutput.write(
            Data(#"{"error":"internal_error","ok":false}"#.utf8)
        )
        FileHandle.standardOutput.write(Data([0x0A]))
        outputLock.unlock()
        return
    }

    outputLock.lock()
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
    fflush(stdout)
    outputLock.unlock()
}

private func emitWatchSnapshot(force: Bool) {
    watchState.lock.lock()
    let request = watchState.request
    watchState.lock.unlock()

    guard let request else {
        return
    }

    do {
        let response = try resolve(request)
        let displayID = response.data.display.id
        watchState.lock.lock()
        let previous = watchState.lastDisplayID
        let shouldEmit = force || previous != displayID
        if shouldEmit {
            watchState.lastDisplayID = displayID
        }
        watchState.lock.unlock()

        if shouldEmit {
            writeJSON(response)
        }
    } catch let error as HelperError {
        writeJSON(ErrorResponse(error: error.rawValue, requestId: request.requestId))
    } catch {
        writeJSON(ErrorResponse(error: HelperError.internalError.rawValue, requestId: request.requestId))
    }
}

private func ensureWatchLoop() {
    watchState.lock.lock()
    let alreadyStarted = watchState.started
    if !alreadyStarted {
        watchState.started = true
    }
    watchState.lock.unlock()
    guard !alreadyStarted else {
        return
    }

    // Display configuration changes (hot plug / arrangement) trigger an immediate check.
    CGDisplayRegisterReconfigurationCallback({ _, _, _ in
        emitWatchSnapshot(force: false)
    }, nil)

    DispatchQueue.global(qos: .utility).async {
        while true {
            watchState.lock.lock()
            let intervalMs = max(50, watchState.request?.intervalMs ?? 200)
            let active = watchState.request != nil
            watchState.lock.unlock()

            if active {
                emitWatchSnapshot(force: false)
            }

            Thread.sleep(forTimeInterval: Double(intervalMs) / 1000.0)
        }
    }
}

private func handleLine(_ input: String) {
    var requestId: String?
    do {
        let request = try decodeRequest(Data(input.utf8))
        requestId = request.requestId
        switch request.op {
        case "watch":
            watchState.lock.lock()
            watchState.request = request
            watchState.lastDisplayID = nil
            watchState.lock.unlock()
            ensureWatchLoop()
            emitWatchSnapshot(force: true)
        case "unwatch":
            watchState.lock.lock()
            watchState.request = nil
            watchState.lastDisplayID = nil
            watchState.lock.unlock()
            writeJSON(EventResponse(event: "unwatched", requestId: request.requestId))
        default:
            writeJSON(try resolve(request))
        }
    } catch let error as HelperError {
        writeJSON(ErrorResponse(error: error.rawValue, requestId: requestId))
    } catch {
        writeJSON(ErrorResponse(error: HelperError.internalError.rawValue, requestId: requestId))
    }
}

guard let firstInput = readLine() else {
    writeJSON(ErrorResponse(error: HelperError.invalidRequest.rawValue))
    exit(EXIT_SUCCESS)
}

handleLine(firstInput)
while let input = readLine() {
    handleLine(input)
}
