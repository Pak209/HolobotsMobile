import Foundation

struct WatchHolobot: Identifiable, Hashable {
    let name: String
    let assetName: String

    var id: String { name }

    static let all: [WatchHolobot] = [
        .init(name: "ACE", assetName: "WatchHolobotACE"),
        .init(name: "KUMA", assetName: "WatchHolobotKUMA"),
        .init(name: "SHADOW", assetName: "WatchHolobotSHADOW"),
        .init(name: "ERA", assetName: "WatchHolobotERA"),
        .init(name: "HARE", assetName: "WatchHolobotHARE"),
        .init(name: "TORA", assetName: "WatchHolobotTORA"),
        .init(name: "WAKE", assetName: "WatchHolobotWAKE"),
        .init(name: "GAMA", assetName: "WatchHolobotGAMA"),
        .init(name: "KEN", assetName: "WatchHolobotKEN"),
        .init(name: "KURAI", assetName: "WatchHolobotKURAI"),
        .init(name: "TSUIN", assetName: "WatchHolobotTSUIN"),
        .init(name: "WOLF", assetName: "WatchHolobotWOLF"),
    ]

    static let defaultHolobot = all[1]

    static func named(_ name: String) -> WatchHolobot {
        all.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) ?? defaultHolobot
    }
}
