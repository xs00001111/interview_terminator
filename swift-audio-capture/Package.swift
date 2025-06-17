// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "swift-audio-capture",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "swift-audio-capture",
            targets: ["swift-audio-capture"]
        )
    ],
    dependencies: [
        // No external dependencies needed - using system frameworks
    ],
    targets: [
        .executableTarget(
            name: "swift-audio-capture",
            dependencies: [],
            path: "Sources",
            sources: ["main.swift"],
            linkerSettings: [
                .linkedFramework("AVFoundation"),
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("CoreAudio"),
                .linkedFramework("AudioToolbox"),
                .linkedFramework("Foundation")
            ]
        )
    ]
)