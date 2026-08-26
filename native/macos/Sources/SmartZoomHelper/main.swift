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
}

private struct ErrorResponse: Encodable {
    let ok = false
    let error: String
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

    return windowInfo.enumerated().compactMap { listOrder, info in
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

        return WindowCandidate(ownerPID: ownerPID, bounds: bounds, listOrder: listOrder)
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

private func resolve(_ request: HelperRequest) throws -> SuccessResponse {
    let family = processFamily(startingAt: request.pid)
    let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
    guard let window = selectWindow(
        from: windowCandidates(),
        eligiblePIDs: family,
        frontmostPID: frontmostPID
    ) else {
        throw HelperError.windowNotFound
    }

    guard let display = displayContainingWindowCenter(
        window.bounds,
        displays: activeDisplays()
    ) else {
        throw HelperError.displayNotFound
    }
    guard let displayID = persistentID(for: display.id) else {
        throw HelperError.displayNotFound
    }

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
        )
    )
}

private func writeJSON<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]

    guard let data = try? encoder.encode(value) else {
        FileHandle.standardOutput.write(
            Data(#"{"error":"internal_error","ok":false}"#.utf8)
        )
        FileHandle.standardOutput.write(Data([0x0A]))
        return
    }

    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

guard let input = readLine() else {
    writeJSON(ErrorResponse(error: HelperError.invalidRequest.rawValue))
    exit(EXIT_SUCCESS)
}

do {
    let request = try decodeRequest(Data(input.utf8))
    writeJSON(try resolve(request))
} catch let error as HelperError {
    writeJSON(ErrorResponse(error: error.rawValue))
} catch {
    writeJSON(ErrorResponse(error: HelperError.internalError.rawValue))
}
