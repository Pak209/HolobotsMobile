import SwiftUI
import WatchConnectivity

@main
struct HolobotsWatchApp: App {
    @StateObject private var viewModel = WorkoutViewModel()
    @StateObject private var connectivity = WatchConnectivityManager.shared

    init() {
        WatchConnectivityManager.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(viewModel)
                .environmentObject(connectivity)
                .onReceive(connectivity.$incomingRewards) { rewards in
                    guard let rewards else { return }
                    viewModel.applyRewards(rewards)
                }
        }
    }
}
