import CoreGraphics
import Foundation

struct HelperRequest: Decodable {
    let op: String
    let pid: Int32
    let titleHint: String?
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
    let title: String?

    init(ownerPID: Int32, bounds: CGRect, listOrder: Int, title: String? = nil) {
        self.ownerPID = ownerPID
        self.bounds = bounds
        self.listOrder = listOrder
        self.title = title
    }
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
    frontmostPID: Int32?,
    titleHint: String? = nil
) -> WindowCandidate? {
    let pidRanks = Dictionary(
        uniqueKeysWithValues: eligiblePIDs.enumerated().map { ($0.element, $0.offset) }
    )
    let eligibleWindows = windows.filter {
        pidRanks[$0.ownerPID] != nil &&
            $0.bounds.width >= 100 &&
            $0.bounds.height >= 100
    }
    let normalizedTitleHint = titleHint?.trimmingCharacters(in: .whitespacesAndNewlines)

    return eligibleWindows.min { lhs, rhs in
        let lhsMatchesTitle = normalizedTitleHint.map {
            !$0.isEmpty && (lhs.title?.localizedCaseInsensitiveContains($0) ?? false)
        } ?? false
        let rhsMatchesTitle = normalizedTitleHint.map {
            !$0.isEmpty && (rhs.title?.localizedCaseInsensitiveContains($0) ?? false)
        } ?? false
        if lhsMatchesTitle != rhsMatchesTitle {
            return lhsMatchesTitle
        }

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
