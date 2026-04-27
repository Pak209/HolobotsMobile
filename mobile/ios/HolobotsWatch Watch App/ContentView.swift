import SwiftUI

struct ContentView: View {
    @EnvironmentObject var viewModel: WorkoutViewModel
    @EnvironmentObject var connectivity: WatchConnectivityManager

    var body: some View {
        ZStack {
            if viewModel.showRewards, let rewards = viewModel.rewardsPayload {
                RewardsView(rewards: rewards)
            } else if !viewModel.isRunning && viewModel.elapsedSeconds == 0 {
                PreWorkoutView()
            } else {
                ActiveWorkoutView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: viewModel.showRewards)
    }
}
