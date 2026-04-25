import SwiftUI

struct ActiveWorkoutView: View {
    @EnvironmentObject var viewModel: WorkoutViewModel

    // Gold / dark palette matching the mobile app
    private let gold     = Color(red: 0.94, green: 0.75, blue: 0.08)
    private let dimGold  = Color(red: 0.94, green: 0.75, blue: 0.08).opacity(0.55)
    private let darkBg   = Color(red: 0.02, green: 0.03, blue: 0.04)
    private let panel    = Color(red: 0.04, green: 0.05, blue: 0.06)
    private let accent   = Color(red: 0.06, green: 0.08, blue: 0.10)
    private let gaugeGray = Color.white.opacity(0.28)

    var body: some View {
        ZStack {
            darkBg.ignoresSafeArea()

            VStack(spacing: 0) {
                // ── Header label ──────────────────────────────────────────
                Text("SYNC WORKOUT")
                    .font(.system(size: 11, weight: .black))
                    .foregroundColor(gold)
                    .kerning(1.8)
                    .padding(.top, 6)

                Spacer(minLength: 2)

                ZStack {
                    SpeedometerGauge(
                        speedKmh: viewModel.speedKmh,
                        needleAngle: viewModel.needleAngle,
                        gold: gold,
                        gaugeGray: gaugeGray
                    )

                    // Overlay: speed value + unit + countdown timer
                    VStack(spacing: 1) {
                        Text(String(format: "%.1f", viewModel.speedKmh))
                            .font(.system(size: 24, weight: .black, design: .monospaced))
                            .foregroundColor(.white)
                            .monospacedDigit()
                        Text("KM/H")
                            .font(.system(size: 8, weight: .heavy))
                            .foregroundColor(dimGold)
                            .kerning(1.2)
                        Text(timerLabel)
                            .font(.system(size: 10, weight: .heavy, design: .monospaced))
                            .foregroundColor(gold.opacity(0.8))
                            .monospacedDigit()
                            .padding(.top, 2)
                    }
                    .offset(y: 6)
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 2)

                Spacer(minLength: 4)

                // ── Sync Point counter + Distance ─────────────────────────
                HStack(spacing: 0) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("SYNC PTS")
                            .font(.system(size: 8, weight: .heavy))
                            .foregroundColor(dimGold)
                            .kerning(1.1)
                        Text("\(viewModel.currentRewards.syncPoints)")
                            .font(.system(size: 22, weight: .black, design: .monospaced))
                            .foregroundColor(gold)
                            .monospacedDigit()
                            .contentTransition(.numericText())
                            .animation(.easeOut(duration: 0.3), value: viewModel.currentRewards.syncPoints)
                    }

                    Spacer()

                    VStack(alignment: .trailing, spacing: 1) {
                        Text("DIST")
                            .font(.system(size: 8, weight: .heavy))
                            .foregroundColor(dimGold)
                            .kerning(1.1)
                        Text(String(format: "%.2f km", viewModel.distanceKm))
                            .font(.system(size: 13, weight: .bold, design: .monospaced))
                            .foregroundColor(.white.opacity(0.75))
                            .monospacedDigit()
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(panel)
                .overlay(Rectangle().stroke(gold.opacity(0.25), lineWidth: 0.5))

                Spacer(minLength: 6)

                // ── Session indicator ─────────────────────────────────────
                HStack(spacing: 4) {
                    ForEach(0..<WorkoutConfig.maxDailySessions, id: \.self) { i in
                        Circle()
                            .fill(i < viewModel.sessionsCompleted ? gold : gold.opacity(0.18))
                            .frame(width: 6, height: 6)
                    }
                }

                Spacer(minLength: 4)

                // ── Start / Pause button ──────────────────────────────────
                HStack(spacing: 8) {
                    Button(action: viewModel.toggleRunning) {
                        ZStack {
                            Rectangle()
                                .fill(viewModel.isRunning ? dimGold : gold)
                            Image(systemName: viewModel.isRunning ? "pause.fill" : "play.fill")
                                .font(.system(size: 18, weight: .black))
                                .foregroundColor(darkBg)
                        }
                        .frame(height: 36)
                    }
                    .buttonStyle(.plain)

                    // Finish early (only while running or paused mid-session)
                    if viewModel.elapsedSeconds > 0 && !viewModel.isComplete {
                        Button(action: viewModel.finishNow) {
                            ZStack {
                                Rectangle()
                                    .fill(accent)
                                    .overlay(Rectangle().stroke(gold.opacity(0.35), lineWidth: 0.5))
                                Image(systemName: "checkmark")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundColor(gold)
                            }
                            .frame(width: 36, height: 36)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.bottom, 4)

                // ── Sync status strip ─────────────────────────────────────
                if viewModel.syncStatus == .sending {
                    Text("SYNCING…")
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundColor(dimGold)
                        .kerning(1.2)
                        .padding(.bottom, 2)
                }
            }
            .padding(.horizontal, 6)
        }
    }

    // mm:ss from remaining seconds
    private var timerLabel: String {
        let m = viewModel.remainingSeconds / 60
        let s = viewModel.remainingSeconds % 60
        return String(format: "%d:%02d", m, s)
    }
}

private struct SpeedometerGauge: View {
    let speedKmh: Double
    let needleAngle: Angle
    let gold: Color
    let gaugeGray: Color

    private let maxKmh = 18.0

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let gaugeSize = min(width, 140)
            let radius = gaugeSize / 2
            let center = CGPoint(x: geo.size.width / 2, y: radius + 2)

            ZStack {
                Path { path in
                    path.addArc(
                        center: center,
                        radius: radius - 8,
                        startAngle: .degrees(180),
                        endAngle: .degrees(0),
                        clockwise: false
                    )
                }
                .stroke(gaugeGray, style: StrokeStyle(lineWidth: 6, lineCap: .round))

                Path { path in
                    path.addArc(
                        center: center,
                        radius: radius - 8,
                        startAngle: .degrees(180),
                        endAngle: .degrees(0),
                        clockwise: false
                    )
                }
                .trim(from: 0, to: min(max(speedKmh / maxKmh, 0), 1))
                .stroke(gold, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(180), anchor: .center)

                ForEach([0.0, 5.0, 9.0, 14.0, 18.0], id: \.self) { mark in
                    let angle = Angle.degrees(-180 + (mark / maxKmh) * 180)
                    TickMark(
                        center: center,
                        angle: angle,
                        radius: radius - 10,
                        label: Int(mark)
                    )
                }

                NeedleShape()
                    .fill(gold)
                    .frame(width: gaugeSize * 0.42, height: 8)
                    .position(center)
                    .rotationEffect(needleAngle)
                    .animation(.easeOut(duration: 0.35), value: speedKmh)

                Circle()
                    .fill(gold)
                    .frame(width: 18, height: 18)
                    .position(center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(height: 96)
    }
}

private struct TickMark: View {
    let center: CGPoint
    let angle: Angle
    let radius: CGFloat
    let label: Int

    var body: some View {
        let tickLength: CGFloat = label == 9 ? 14 : 10
        let radians = CGFloat(angle.radians)
        let start = CGPoint(
            x: center.x + cos(radians) * (radius - tickLength),
            y: center.y + sin(radians) * (radius - tickLength)
        )
        let end = CGPoint(
            x: center.x + cos(radians) * radius,
            y: center.y + sin(radians) * radius
        )
        let labelPoint = CGPoint(
            x: center.x + cos(radians) * (radius - 22),
            y: center.y + sin(radians) * (radius - 22)
        )

        return ZStack {
            Path { path in
                path.move(to: start)
                path.addLine(to: end)
            }
            .stroke(Color.white.opacity(0.6), lineWidth: label == 9 ? 2.5 : 1.4)

            Text("\(label)")
                .font(.system(size: 7, weight: .bold, design: .monospaced))
                .foregroundColor(Color.white.opacity(0.65))
                .position(labelPoint)
        }
    }
}

private struct NeedleShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let midY = rect.midY
        path.move(to: CGPoint(x: rect.minX + 4, y: midY))
        path.addLine(to: CGPoint(x: rect.maxX - 10, y: midY - 2))
        path.addLine(to: CGPoint(x: rect.maxX, y: midY))
        path.addLine(to: CGPoint(x: rect.maxX - 10, y: midY + 2))
        path.closeSubpath()
        return path
    }
}

#Preview {
    ActiveWorkoutView()
        .environmentObject(WorkoutViewModel())
        .environmentObject(WatchConnectivityManager.shared)
}
