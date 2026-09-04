// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CaptionLocalAsr",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "caption-local-asr"),
        .testTarget(
            name: "CaptionLocalAsrTests",
            dependencies: [.target(name: "caption-local-asr")]
        )
    ]
)
