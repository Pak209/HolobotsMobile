import SwiftUI

struct RewardsView: View {
    @EnvironmentObject var viewModel: WorkoutViewModel
    let rewards: WorkoutRewardsPayload

    private var isSyncing: Bool { viewModel.syncStatus == .sending }

    var body: some View {
        ZStack {
            Holo.carbon.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer(minLength: 22)

                VStack(spacing: 2) {
                    Text("SYNC RESULT")
                        .font(Holo.display(10))
                        .foregroundColor(Holo.accent)
                        .kerning(1.8)
                    Text("COMPLETE")
                        .font(Holo.display(16))
                        .foregroundColor(Holo.text)
                        .kerning(1.2)
                }
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Holo.navy)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Holo.accent, lineWidth: 1.2)
                )
                .padding(.horizontal, 4)

                VStack(spacing: 3) {
                    RewardRow(icon: "HoloRewardSync",  title: "Sync Points", value: rewards.syncPoints)
                    RewardRow(icon: "HoloRewardHolos", title: "Holos",       value: rewards.holos)
                    RewardRow(icon: "HoloRewardExp",   title: "Experience",  value: rewards.exp)
                }
                .padding(.top, 5)
                .padding(.horizontal, 4)

                Spacer(minLength: 8)

                HStack(spacing: 6) {
                    Button(action: viewModel.collectRewards) {
                        Text(isSyncing ? "SYNCING..." : "COLLECT")
                            .font(Holo.display(14))
                            .kerning(1.2)
                            .foregroundColor(Holo.carbon)
                            .frame(maxWidth: .infinity)
                            .frame(height: 26)
                            .background(Holo.accent, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(isSyncing)

                    Button(action: viewModel.quickRefill) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 9, style: .continuous)
                                .fill(Holo.raised)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                                        .stroke(Holo.accent, lineWidth: 1)
                                )
                            BatteryChargingIcon(color: Holo.accent)
                                .frame(width: 16, height: 16)
                        }
                        .frame(width: 34, height: 26)
                    }
                    .buttonStyle(.plain)
                    .disabled(isSyncing)
                }
                .padding(.horizontal, 4)

                HStack(spacing: 4) {
                    ForEach(0..<WorkoutConfig.maxDailySessions, id: \.self) { i in
                        Circle()
                            .fill(i < rewards.sessionsCompleted ? Holo.accent : Holo.border)
                            .frame(width: 5, height: 5)
                    }
                    Text("\(rewards.sessionsRemaining) left today")
                        .font(Holo.display(10))
                        .foregroundColor(Holo.muted)
                }
                .padding(.top, 7)

                HStack(spacing: 4) {
                    Image(systemName: "heart.fill")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundColor(Holo.danger)
                    Text("Workout saved to Apple Health")
                        .font(Holo.display(10))
                        .foregroundColor(Holo.muted)
                }
                .padding(.top, 4)
                .padding(.bottom, 6)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 2)
        }
    }
}

private struct RewardRow: View {
    let icon: String
    let title: String
    let value: Int

    var body: some View {
        HStack(spacing: 0) {
            Image(icon)
                .resizable()
                .scaledToFit()
                .frame(width: 16, height: 16)
                .frame(width: 28)
                .padding(.leading, 6)
                .accessibilityHidden(true)

            Text(title.uppercased())
                .font(Holo.display(10))
                .foregroundColor(Holo.muted)
                .kerning(0.7)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text("+\(value)")
                .font(Holo.display(15))
                .foregroundColor(Holo.text)
                .monospacedDigit()
                .padding(.trailing, 8)
        }
        .frame(height: 28)
        .background(Holo.navy)
        .overlay(Rectangle().stroke(Holo.border, lineWidth: 0.5))
    }
}

private struct BatteryChargingIcon: View {
    let color: Color

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height

            ZStack {
                Path { path in
                    path.move(to: CGPoint(x: w * 0.18, y: h * 0.22))
                    path.addLine(to: CGPoint(x: w * 0.64, y: h * 0.22))
                    path.addArc(
                        center: CGPoint(x: w * 0.72, y: h * 0.30),
                        radius: w * 0.08,
                        startAngle: .degrees(-90),
                        endAngle: .degrees(0),
                        clockwise: false
                    )
                    path.addLine(to: CGPoint(x: w * 0.80, y: h * 0.40))
                    path.addLine(to: CGPoint(x: w * 0.88, y: h * 0.40))
                    path.addLine(to: CGPoint(x: w * 0.88, y: h * 0.60))
                    path.addLine(to: CGPoint(x: w * 0.80, y: h * 0.60))
                    path.addLine(to: CGPoint(x: w * 0.80, y: h * 0.70))
                    path.addArc(
                        center: CGPoint(x: w * 0.72, y: h * 0.78),
                        radius: w * 0.08,
                        startAngle: .degrees(0),
                        endAngle: .degrees(90),
                        clockwise: false
                    )
                    path.addLine(to: CGPoint(x: w * 0.18, y: h * 0.86))
                    path.addArc(
                        center: CGPoint(x: w * 0.10, y: h * 0.78),
                        radius: w * 0.08,
                        startAngle: .degrees(90),
                        endAngle: .degrees(180),
                        clockwise: false
                    )
                    path.addLine(to: CGPoint(x: w * 0.02, y: h * 0.30))
                    path.addArc(
                        center: CGPoint(x: w * 0.10, y: h * 0.22),
                        radius: w * 0.08,
                        startAngle: .degrees(180),
                        endAngle: .degrees(270),
                        clockwise: false
                    )
                }
                .stroke(color, style: StrokeStyle(lineWidth: max(1.4, w * 0.09), lineCap: .round, lineJoin: .round))

                Path { path in
                    path.move(to: CGPoint(x: w * 0.52, y: h * 0.12))
                    path.addLine(to: CGPoint(x: w * 0.35, y: h * 0.48))
                    path.addLine(to: CGPoint(x: w * 0.58, y: h * 0.48))
                    path.addLine(to: CGPoint(x: w * 0.42, y: h * 0.88))
                }
                .stroke(color, style: StrokeStyle(lineWidth: max(1.2, w * 0.09), lineCap: .round, lineJoin: .round))
            }
        }
    }
}

#Preview {
    RewardsView(rewards: WorkoutRewardsPayload(from: [
        "syncPoints": 247,
        "holos": 14,
        "exp": 330,
        "sessionsCompleted": 2,
        "sessionsRemaining": 2,
        "totalSyncPoints": 1842,
    ])!)
    .environmentObject(WorkoutViewModel())
    .environmentObject(WatchConnectivityManager.shared)
}
