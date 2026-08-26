import CoreGraphics
import Foundation

struct HelperRequest: Decodable {
    let op: String
    let pid: Int32
}

enum HelperError: String, Error {
    case invalidRequest = "invalid_request"
    case unsupportedOperation = "unsupported_operation"
    case invalidPID = "invalid_pid"
    case windowNotFound = "window_not_found"
    case displayNotFound = "display_not_found"
    case internalError = "internal_error"
}

struct WindowCandidate {
    let ownerPID: Int32
    let bounds: CGRect
    let listOrder: Int
}

struct DisplayCandidate {
    let id: CGDirectDisplayID
    let bounds: CGRect
}

func decodeRequest(_ data: Data) throws -> HelperRequest {
    let request: HelperRequest

    do {
        request = try JSONDecoder().decode(HelperRequest.self, from: data)
    } catch {
        throw HelperError.invalidRequest
    }

    guard request.op == "getCurrentWindowDisplay" else {
        throw HelperError.unsupportedOperation
    }
    guard request.pid > 0 else {
        throw HelperError.invalidPID
    }

    return request
}

func selectWindow(
    from windows: [WindowCandidate],
    eligiblePIDs: [Int32],
    frontmostPID: Int32?
) -> WindowCandidate? {
    let pidRanks = Dictionary(
        uniqueKeysWithValues: eligiblePIDs.enumerated().map { ($0.element, $0.offset) }
    )
    let eligibleWindows = windows.filter {
        pidRanks[$0.ownerPID] != nil &&
            $0.bounds.width >= 100 &&
            $0.bounds.height >= 100
    }

    return eligibleWindows.min { lhs, rhs in
        let lhsIsFrontmost = lhs.ownerPID == frontmostPID
        let rhsIsFrontmost = rhs.ownerPID == frontmostPID
        if lhsIsFrontmost != rhsIsFrontmost {
            return lhsIsFrontmost
        }

        let lhsRank = pidRanks[lhs.ownerPID] ?? Int.max
        let rhsRank = pidRanks[rhs.ownerPID] ?? Int.max
        if lhsRank != rhsRank {
            return lhsRank < rhsRank
        }

        return lhs.listOrder < rhs.listOrder
    }
}

func displayContainingWindowCenter(
    _ windowBounds: CGRect,
    displays: [DisplayCandidate]
) -> DisplayCandidate? {
    let center = CGPoint(x: windowBounds.midX, y: windowBounds.midY)
    return displays.first { $0.bounds.contains(center) }
}
