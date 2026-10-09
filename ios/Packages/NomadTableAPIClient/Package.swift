// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NomadTableAPIClient",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "NomadTableAPIClient", targets: ["NomadTableAPIClient"])
    ],
    targets: [
        .target(name: "NomadTableAPIClient"),
        .executableTarget(name: "DecodeCheck", dependencies: ["NomadTableAPIClient"], path: "Sources/DecodeCheck")
    ]
)
