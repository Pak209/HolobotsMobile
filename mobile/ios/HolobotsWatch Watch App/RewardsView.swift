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

    var body: some View {
        ZStack {
            darkBg.ignoresSafeArea()

            VStack(spacing: 0) {
                // ── Header ─────────────────────────────────────────────────
                VStack(spacing: 2) {
                    Text("SYNC RESULT")
                        .font(.system(size: 9, weight: .black))
                        .foregroundColor(gold)
                        .kerning(1.8)
                    Text("COMPLETE")
                        .font(.system(size: 18, weight: .black))
                        .foregroundColor(cream)
                        .kerning(1.2)
                }
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity)
                .background(panel)
                .overlay(Rectangle().stroke(gold, lineWidth: 1.5).padding(.bottom, -1))

                // ── Reward rows ────────────────────────────────────────────
                VStack(spacing: 3) {
                    RewardRow(label: "SP",  title: "Sync Points", value: rewards.syncPoints, gold: gold, cream: cream, panel: panel)
                    RewardRow(label: "H",   title: "Holos",       value: rewards.holos,      gold: gold, cream: cream, panel: panel)
                    RewardRow(label: "EXP", title: "Experience",  value: rewards.exp,        gold: gold, cream: cream, panel: panel)
                }
                .padding(.top, 6)
                .padding(.horizontal, 4)

                // ── Sessions remaining ─────────────────────────────────────
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
                .padding(.top, 6)

                Spacer(minLength: 6)

                // ── Collect button ─────────────────────────────────────────
                HStack(spacing: 6) {
                    Button(action: viewModel.collectRewards) {
                        Text("COLLECT")
                            .font(.system(size: 13, weight: .black))
                            .kerning(1.2)
                            .foregroundColor(darkBg)
                            .frame(maxWidth: .infinity)
                            .frame(height: 32)
                            .background(gold)
                    }
                    .buttonStyle(.plain)

                    Button(action: viewModel.quickRefill) {
                        ZStack {
                            Rectangle()
                                .fill(accent)
                                .overlay(Rectangle().stroke(gold, lineWidth: 1))
                            Image(systemName: "bolt.fill")
                                .font(.system(size: 13, weight: .black))
                                .foregroundColor(gold)
                        }
                        .frame(width: 34, height: 32)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 4)
                .padding(.bottom, 4)
            }
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
