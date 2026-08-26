import CoreGraphics
import Foundation

struct HelperRequest: Decodable {
    let op: String
    let pid: Int32?
    let titleHint: String?
    let intervalMs: Int?
    let requestId: String?
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
    let ownerName: String?

    init(
        ownerPID: Int32,
        bounds: CGRect,
        listOrder: Int,
        title: String? = nil,
        ownerName: String? = nil
    ) {
        self.ownerPID = ownerPID
        self.bounds = bounds
        self.listOrder = listOrder
        self.title = title
        self.ownerName = ownerName
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

    switch request.op {
    case "getCurrentWindowDisplay", "watch":
        guard let pid = request.pid, pid > 0 else {
            throw HelperError.invalidPID
        }
    case "unwatch":
        break
    default:
        throw HelperError.unsupportedOperation
    }

    return request
}

func selectWindow(
    from windows: [WindowCandidate],
    eligiblePIDs: [Int32],
    frontmostPID: Int32?,
    titleHint: String? = nil,
    ownerNameHints: [String] = ["Cursor", "Code", "Visual Studio Code"]
) -> WindowCandidate? {
    let pidRanks = Dictionary(
        uniqueKeysWithValues: eligiblePIDs.enumerated().map { ($0.element, $0.offset) }
    )
    let normalizedTitleHint = titleHint?.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedOwnerHints = ownerNameHints
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        .filter { !$0.isEmpty }

    let eligibleWindows = windows.filter { window in
        guard window.bounds.width >= 50, window.bounds.height >= 50 else {
            return false
        }

        if pidRanks[window.ownerPID] != nil {
            return true
        }

        let owner = window.ownerName?.lowercased() ?? ""
        return normalizedOwnerHints.contains { owner.contains($0) }
    }

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

        let lhsPidMatch = pidRanks[lhs.ownerPID] != nil
        let rhsPidMatch = pidRanks[rhs.ownerPID] != nil
        if lhsPidMatch != rhsPidMatch {
            return lhsPidMatch
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
    if let exact = displays.first(where: { $0.bounds.contains(center) }) {
        return exact
    }

    return displays.min { lhs, rhs in
        distanceSquared(center, lhs.bounds) < distanceSquared(center, rhs.bounds)
    }
}

private func distanceSquared(_ point: CGPoint, _ rect: CGRect) -> CGFloat {
    let x = min(max(point.x, rect.minX), rect.maxX)
    let y = min(max(point.y, rect.minY), rect.maxY)
    let dx = point.x - x
    let dy = point.y - y
    return dx * dx + dy * dy
}
