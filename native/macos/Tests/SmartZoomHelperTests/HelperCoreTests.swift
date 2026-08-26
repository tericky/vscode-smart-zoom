import CoreGraphics
import XCTest
@testable import SmartZoomHelper

final class HelperCoreTests: XCTestCase {
    func testDecodeAcceptsSupportedRequest() throws {
        let request = try decodeRequest(
            Data(#"{"op":"getCurrentWindowDisplay","pid":12345,"titleHint":"README.md"}"#.utf8)
        )

        XCTAssertEqual(request.op, "getCurrentWindowDisplay")
        XCTAssertEqual(request.pid, 12345)
        XCTAssertEqual(request.titleHint, "README.md")
    }

    func testDecodeRejectsUnsupportedOperation() {
        XCTAssertThrowsError(try decodeRequest(Data(#"{"op":"unknown","pid":12345}"#.utf8))) { error in
            XCTAssertEqual(error as? HelperError, .unsupportedOperation)
        }
    }

    func testDecodeRejectsNonPositivePID() {
        XCTAssertThrowsError(
            try decodeRequest(Data(#"{"op":"getCurrentWindowDisplay","pid":0}"#.utf8))
        ) { error in
            XCTAssertEqual(error as? HelperError, .invalidPID)
        }
    }

    func testSelectWindowFavorsFrontmostEligibleOwner() {
        let windows = [
            WindowCandidate(
                ownerPID: 100,
                bounds: CGRect(x: 0, y: 0, width: 1200, height: 800),
                listOrder: 1
            ),
            WindowCandidate(
                ownerPID: 200,
                bounds: CGRect(x: 1500, y: 100, width: 900, height: 700),
                listOrder: 0
            )
        ]

        let selected = selectWindow(
            from: windows,
            eligiblePIDs: [100, 200],
            frontmostPID: 200
        )

        XCTAssertEqual(selected?.ownerPID, 200)
    }

    func testSelectWindowUsesFrontToBackOrderForSameOwner() {
        let back = WindowCandidate(
            ownerPID: 100,
            bounds: CGRect(x: 0, y: 0, width: 1600, height: 1000),
            listOrder: 2
        )
        let front = WindowCandidate(
            ownerPID: 100,
            bounds: CGRect(x: 100, y: 100, width: 900, height: 700),
            listOrder: 0
        )

        let selected = selectWindow(
            from: [back, front],
            eligiblePIDs: [100],
            frontmostPID: 100
        )

        XCTAssertEqual(selected?.bounds, front.bounds)
    }

    func testSelectWindowPrefersCaseInsensitiveTitleMatchOverFrontmost() {
        let matching = WindowCandidate(
            ownerPID: 100,
            bounds: CGRect(x: 0, y: 0, width: 1200, height: 800),
            listOrder: 1,
            title: "README.md — vscode-smart-zoom"
        )
        let frontmost = WindowCandidate(
            ownerPID: 200,
            bounds: CGRect(x: 1500, y: 100, width: 900, height: 700),
            listOrder: 0,
            title: "extension.ts — vscode-smart-zoom"
        )

        let selected = selectWindow(
            from: [matching, frontmost],
            eligiblePIDs: [100, 200],
            frontmostPID: 200,
            titleHint: "readme.MD"
        )

        XCTAssertEqual(selected?.ownerPID, 100)
    }

    func testDisplayContainingWindowCenterReturnsMatchingDisplay() {
        let displays = [
            DisplayCandidate(id: 1, bounds: CGRect(x: 0, y: 0, width: 1920, height: 1080)),
            DisplayCandidate(id: 2, bounds: CGRect(x: 1920, y: 0, width: 2560, height: 1440))
        ]
        let window = CGRect(x: 2200, y: 100, width: 1000, height: 800)

        XCTAssertEqual(displayContainingWindowCenter(window, displays: displays)?.id, 2)
    }

    func testDisplayContainingWindowCenterFallsBackToNearestDisplay() {
        let displays = [
            DisplayCandidate(id: 1, bounds: CGRect(x: 0, y: 0, width: 1920, height: 1080)),
            DisplayCandidate(id: 2, bounds: CGRect(x: 1920, y: 0, width: 2560, height: 1440))
        ]
        let window = CGRect(x: 5000, y: 100, width: 100, height: 100)

        XCTAssertEqual(displayContainingWindowCenter(window, displays: displays)?.id, 2)
    }

    func testSelectWindowCanMatchEditorOwnerNameWhenPIDFamilyMisses() {
        let cursorWindow = WindowCandidate(
            ownerPID: 999,
            bounds: CGRect(x: 0, y: 0, width: 1200, height: 800),
            listOrder: 0,
            title: "README.md",
            ownerName: "Cursor"
        )

        let selected = selectWindow(
            from: [cursorWindow],
            eligiblePIDs: [100],
            frontmostPID: 999,
            titleHint: "README"
        )

        XCTAssertEqual(selected?.ownerPID, 999)
    }
}
