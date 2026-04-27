import SwiftUI

struct RewardsView: View {
    @EnvironmentObject var viewModel: WorkoutViewModel
    let rewards: WorkoutRewardsPayload

    private let gold    = Color(red: 0.94, green: 0.75, blue: 0.08)
    private let dimGold = Color(red: 0.94, green: 0.75, blue: 0.08).opacity(0.55)
    private let darkBg  = Color(red: 0.02, green: 0.03, blue: 0.04)
    private let panel   = Color(red: 0.04, green: 0.05, blue: 0.06)
    private let cream   = Color(red: 0.996, green: 0.945, blue: 0.878)
    private let accent  = Color(red: 0.06, green: 0.08, blue: 0.10)
    private var isSyncing: Bool { viewModel.syncStatus == .sending }

    var body: some View {
        ZStack {
            darkBg.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer(minLength: 30)

                VStack(spacing: 2) {
                    Text("SYNC RESULT")
                        .font(.system(size: 9, weight: .black))
                        .foregroundColor(gold)
                        .kerning(1.8)
                    Text("COMPLETE")
                        .font(.system(size: 16, weight: .black))
                        .foregroundColor(cream)
                        .kerning(1.2)
                }
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(panel)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(gold, lineWidth: 1.2)
                )
                .padding(.horizontal, 4)

                VStack(spacing: 3) {
                    RewardRow(label: "SP",  title: "Sync Points", value: rewards.syncPoints, gold: gold, cream: cream, panel: panel)
                    RewardRow(label: "H",   title: "Holos",       value: rewards.holos,      gold: gold, cream: cream, panel: panel)
                    RewardRow(label: "EXP", title: "Experience",  value: rewards.exp,        gold: gold, cream: cream, panel: panel)
                }
                .padding(.top, 5)
                .padding(.horizontal, 4)

                Spacer(minLength: 8)

                HStack(spacing: 6) {
                    Button(action: viewModel.collectRewards) {
                        Text(isSyncing ? "SYNCING..." : "COLLECT")
                            .font(.system(size: 12, weight: .black))
                            .kerning(1.2)
                            .foregroundColor(darkBg)
                            .frame(maxWidth: .infinity)
                            .frame(height: 26)
                            .background(gold, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(isSyncing)

                    Button(action: viewModel.quickRefill) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 9, style: .continuous)
                                .fill(accent)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                                        .stroke(gold, lineWidth: 1)
                                )
                            BatteryChargingIcon(color: gold)
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
                            .fill(i < rewards.sessionsCompleted ? gold : gold.opacity(0.18))
                            .frame(width: 5, height: 5)
                    }
                    Text("\(rewards.sessionsRemaining) left today")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(dimGold)
                }
                .padding(.top, 7)
                .padding(.bottom, 6)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 2)
        }
    }
}

private struct RewardRow: View {
    let label: String
    let title: String
    let value: Int
    let gold: Color
    let cream: Color
    let panel: Color

    var body: some View {
        HStack(spacing: 0) {
            Text(label)
                .font(.system(size: 9, weight: .black))
                .foregroundColor(gold)
                .kerning(0.5)
                .frame(width: 28)
                .padding(.leading, 6)

            Text(title.uppercased())
                .font(.system(size: 9, weight: .heavy))
                .foregroundColor(cream.opacity(0.7))
                .kerning(0.7)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text("+\(value)")
                .font(.system(size: 13, weight: .black, design: .monospaced))
                .foregroundColor(cream)
                .padding(.trailing, 8)
        }
        .frame(height: 28)
        .background(panel)
        .overlay(Rectangle().stroke(gold.opacity(0.2), lineWidth: 0.5))
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
