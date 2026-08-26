// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "SmartZoomHelper",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "SmartZoomHelper"),
        .testTarget(
            name: "SmartZoomHelperTests",
            dependencies: ["SmartZoomHelper"]
        )
    ]
)
