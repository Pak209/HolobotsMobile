import SwiftUI

struct ActiveWorkoutView: View {
    @EnvironmentObject var viewModel: WorkoutViewModel
    @State private var showSettings = false

    private let gold = Color(red: 0.94, green: 0.75, blue: 0.08)
    private let brightGold = Color(red: 0.98, green: 0.80, blue: 0.10)
    private let dimGold = Color(red: 0.94, green: 0.75, blue: 0.08).opacity(0.55)
    private let darkBg = Color(red: 0.02, green: 0.03, blue: 0.04)
    private let panel = Color(red: 0.04, green: 0.05, blue: 0.06)
    private let accent = Color(red: 0.06, green: 0.08, blue: 0.10)
    private let cream = Color(red: 0.996, green: 0.945, blue: 0.878)

    var body: some View {
        ZStack {
            BrandedWorkoutBackground(
                darkBg: darkBg,
                gold: gold,
                brightGold: brightGold
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                ZStack {
                    Text("SYNC")
                        .font(.system(size: 11, weight: .black))
                        .foregroundColor(brightGold)
                        .kerning(1.8)
                }
                .frame(maxWidth: .infinity)
                .overlay(alignment: .leading) {
                    Text(timerLabel)
                        .font(.system(size: 11, weight: .black, design: .monospaced))
                        .foregroundColor(cream)
                        .monospacedDigit()
                }
                .overlay(alignment: .topTrailing) {
                    Button(action: { showSettings = true }) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(panel.opacity(0.95))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .stroke(brightGold.opacity(0.35), lineWidth: 0.8)
                                )

                            SettingsGlyph(color: brightGold)
                                .frame(width: 13, height: 13)
                        }
                        .frame(width: 26, height: 22)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 22)
                }
                .padding(.top, 6)

                Spacer(minLength: 0)

                Text("")
                    .font(.system(size: 11, weight: .black))
                    .hidden()

                Spacer(minLength: 0)

                BrandedSpeedometer(
                    speedLabel: viewModel.speedLabel,
                    speedValue: viewModel.displayedSpeed,
                    needleAngle: viewModel.needleAngle,
                    cream: cream
                )
                .frame(height: 86)
                .padding(.horizontal, 2)
                .offset(y: -14)

                Spacer(minLength: 0)

                HStack(spacing: 0) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("SYNC PTS")
                            .font(.system(size: 8, weight: .heavy))
                            .foregroundColor(dimGold)
                            .kerning(1.1)
                        Text("\(viewModel.currentRewards.syncPoints)")
                            .font(.system(size: 22, weight: .black, design: .monospaced))
                            .foregroundColor(brightGold)
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
                        Text(viewModel.distanceLabel)
                            .font(.system(size: 12, weight: .black, design: .monospaced))
                            .foregroundColor(cream)
                            .monospacedDigit()
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(panel.opacity(0.96))
                .overlay(Rectangle().stroke(brightGold.opacity(0.35), lineWidth: 0.6))

                HStack(spacing: 4) {
                    ForEach(0..<WorkoutConfig.maxDailySessions, id: \.self) { i in
                        Circle()
                            .fill(i < viewModel.sessionsCompleted ? brightGold : brightGold.opacity(0.18))
                            .frame(width: 5, height: 5)
                    }
                }
                .padding(.top, 4)

                Spacer(minLength: 0)

                HStack(spacing: 8) {
                    Button(action: viewModel.toggleRunning) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(viewModel.isRunning ? gold.opacity(0.72) : brightGold)
                            Image(systemName: viewModel.isRunning ? "pause.fill" : "play.fill")
                                .font(.system(size: 16, weight: .black))
                                .foregroundColor(darkBg)
                        }
                        .frame(height: 28)
                    }
                    .buttonStyle(.plain)

                    if viewModel.elapsedSeconds > 0 && !viewModel.isComplete {
                        Button(action: viewModel.finishNow) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(accent)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                                            .stroke(brightGold.opacity(0.5), lineWidth: 0.8)
                                    )
                                Image(systemName: "checkmark")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundColor(brightGold)
                            }
                            .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 2)
                .padding(.bottom, 20)

                if viewModel.syncStatus == .sending {
                    Text("SYNCING…")
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundColor(cream.opacity(0.9))
                        .kerning(1.2)
                        .padding(.bottom, 2)
                }
            }
            .padding(.horizontal, 6)
        }
        .sheet(isPresented: $showSettings) {
            WorkoutSettingsView()
                .environmentObject(viewModel)
        }
    }

    private var timerLabel: String {
        let m = viewModel.remainingSeconds / 60
        let s = viewModel.remainingSeconds % 60
        return String(format: "%d:%02d", m, s)
    }
}

private struct BrandedSpeedometer: View {
    let speedLabel: String
    let speedValue: Double
    let needleAngle: Angle
    let cream: Color

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let height = geo.size.height
            let dialSize = min(width * 0.90, height * 1.70)
            let visibleGaugeHeight = dialSize * 0.56
            let dialCenterY = visibleGaugeHeight * 0.68
            let needleWidth = dialSize * 0.29

            ZStack {
                ZStack {
                    gaugeShell(size: dialSize)

                    Image("SpeedometerNeedle")
                        .resizable()
                        .scaledToFit()
                        .frame(width: needleWidth)
                        .rotationEffect(needleAngle, anchor: UnitPoint(x: 0.16, y: 0.5))
                        .animation(.easeOut(duration: 0.35), value: speedValue)
                }
                .frame(width: dialSize, height: visibleGaugeHeight, alignment: .top)
                .clipped()
                .position(x: width / 2, y: dialCenterY)

                VStack(spacing: 1) {
                    Text(speedLabel)
                        .font(.system(size: 13, weight: .black, design: .rounded))
                        .foregroundColor(cream)
                        .monospacedDigit()
                        .minimumScaleFactor(0.8)
                }
                .position(x: width / 2, y: dialCenterY - dialSize * 0.01)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func gaugeShell(size: CGFloat) -> some View {
        Image("SpeedometerFill")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .mask(
                Image("SpeedometerMask")
                    .resizable()
                    .scaledToFit()
                    .frame(width: size, height: size)
            )
    }
}

struct PreWorkoutView: View {
    @EnvironmentObject var viewModel: WorkoutViewModel
    @EnvironmentObject var connectivity: WatchConnectivityManager
    @State private var showSettings = false
    @State private var showHolobotPicker = false

    private let gold = Color(red: 0.94, green: 0.75, blue: 0.08)
    private let brightGold = Color(red: 0.98, green: 0.80, blue: 0.10)
    private let darkBg = Color(red: 0.02, green: 0.03, blue: 0.04)
    private let panel = Color(red: 0.04, green: 0.05, blue: 0.06)
    private let cream = Color(red: 0.996, green: 0.945, blue: 0.878)

    var body: some View {
        ZStack {
            BrandedWorkoutBackground(
                darkBg: darkBg,
                gold: gold,
                brightGold: brightGold
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                ZStack {
                    Text("SYNC")
                        .font(.system(size: 11, weight: .black))
                        .foregroundColor(brightGold)
                        .kerning(1.8)
                }
                .frame(maxWidth: .infinity)
                .overlay(alignment: .leading) {
                    Text("READY")
                        .font(.system(size: 10, weight: .black))
                        .foregroundColor(cream.opacity(0.9))
                        .kerning(1.1)
                }
                .overlay(alignment: .topTrailing) {
                    Button(action: { showSettings = true }) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(panel.opacity(0.95))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .stroke(brightGold.opacity(0.35), lineWidth: 0.8)
                                )

                            SettingsGlyph(color: brightGold)
                                .frame(width: 13, height: 13)
                        }
                        .frame(width: 26, height: 22)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 22)
                }
                .padding(.top, 6)

                Spacer(minLength: 10)

                VStack(spacing: 8) {
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(viewModel.selectedHolobot.name)
                                .font(.system(size: 19, weight: .black, design: .rounded))
                                .foregroundColor(cream)
                                .minimumScaleFactor(0.7)

                            Text("EXP TARGET")
                                .font(.system(size: 7, weight: .black))
                                .foregroundColor(brightGold.opacity(0.9))
                                .kerning(1.0)
                        }

                        Spacer(minLength: 0)

                        Image(viewModel.selectedHolobot.assetName)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 70, height: 70)
                    }

                    Button(action: { showHolobotPicker = true }) {
                        HStack(spacing: 8) {
                            Text("CHANGE HOLOBOT")
                                .font(.system(size: 10, weight: .black))
                                .foregroundColor(cream)
                                .kerning(0.8)
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(brightGold)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 30)
                        .background(panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(brightGold.opacity(0.55), lineWidth: 0.9)
                        )
                        .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, -2)

                    HStack(spacing: 6) {
                        preWorkoutModeButton(
                            mode: .outdoorWalk,
                            title: "OUTDOOR",
                            icon: .outdoorWalk
                        )
                        preWorkoutModeButton(
                            mode: .treadmill,
                            title: "TREADMILL",
                            icon: .treadmill
                        )
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)

                Spacer(minLength: 60)
            }
            .padding(.horizontal, 8)
        }
        .overlay(alignment: .bottom) {
            Button(action: viewModel.start) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(brightGold)
                    HStack(spacing: 6) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 11, weight: .black))
                        Text("START SYNC")
                            .font(.system(size: 11, weight: .black))
                            .kerning(1.1)
                    }
                    .foregroundColor(darkBg)
                }
                .frame(width: 148, height: 28)
                .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
            .frame(width: 148, height: 28)
            .padding(.bottom, 18)
        }
        .onAppear {
            viewModel.sanitizeSelectedHolobot(availableHolobots: connectivity.ownedHolobots)
            connectivity.requestSessionState()
        }
        .onChange(of: connectivity.ownedHolobots.map(\.name)) {
            viewModel.sanitizeSelectedHolobot(availableHolobots: connectivity.ownedHolobots)
        }
        .sheet(isPresented: $showSettings) {
            WorkoutSettingsView()
                .environmentObject(viewModel)
        }
        .sheet(isPresented: $showHolobotPicker) {
            HolobotPickerView()
                .environmentObject(viewModel)
        }
    }

    private func preWorkoutModeButton(
        mode: WorkoutViewModel.WorkoutMode,
        title: String,
        icon: WorkoutSettingsIcon
    ) -> some View {
        let selected = viewModel.workoutMode == mode

        return Button(action: {
            viewModel.workoutMode = mode
        }) {
            HStack(spacing: 5) {
                workoutSettingsIcon(icon, color: selected ? brightGold : cream.opacity(0.82))
                    .frame(width: 12, height: 12)

                Text(title)
                    .font(.system(size: 7, weight: .black))
                    .foregroundColor(selected ? cream : cream.opacity(0.82))
                    .kerning(0.6)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 22)
            .background(panel.opacity(selected ? 0.96 : 0.72), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .stroke(selected ? brightGold.opacity(0.8) : brightGold.opacity(0.25), lineWidth: 0.8)
            )
            .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .frame(height: 22)
    }
}

private struct HolobotPickerView: View {
    @EnvironmentObject var viewModel: WorkoutViewModel
    @EnvironmentObject var connectivity: WatchConnectivityManager
    @Environment(\.dismiss) private var dismiss

    private let brightGold = Color(red: 0.98, green: 0.80, blue: 0.10)
    private let darkBg = Color(red: 0.02, green: 0.03, blue: 0.04)
    private let panel = Color(red: 0.04, green: 0.05, blue: 0.06)
    private let cream = Color(red: 0.996, green: 0.945, blue: 0.878)

    var body: some View {
        ZStack {
            darkBg.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("HOLOBOTS")
                            .font(.system(size: 13, weight: .black))
                            .foregroundColor(brightGold)
                            .kerning(1.8)

                        Spacer()

                        Button("DONE") {
                            dismiss()
                        }
                        .font(.system(size: 11, weight: .black))
                        .foregroundColor(cream)
                        .buttonStyle(.plain)
                    }

                    if viewModel.isRunning {
                        Text("Finish or pause the current workout before changing holobots.")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(cream.opacity(0.75))
                    }

                    ForEach(connectivity.ownedHolobots) { holobot in
                        Button(action: {
                            guard !viewModel.isRunning else { return }
                            viewModel.selectHolobot(holobot)
                            dismiss()
                        }) {
                            HStack(spacing: 8) {
                                Image(holobot.assetName)
                                    .resizable()
                                    .scaledToFit()
                                    .frame(width: 40, height: 40)

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(holobot.name)
                                        .font(.system(size: 12, weight: .black))
                                        .foregroundColor(cream)
                                    Text("Apply watch EXP here")
                                        .font(.system(size: 9, weight: .medium))
                                        .foregroundColor(cream.opacity(0.65))
                                }

                                Spacer(minLength: 0)

                                Circle()
                                    .fill(viewModel.selectedHolobotName == holobot.name ? brightGold : brightGold.opacity(0.12))
                                    .frame(width: 16, height: 16)
                                    .overlay(
                                        Circle()
                                            .stroke(brightGold.opacity(0.9), lineWidth: 1)
                                    )
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 6)
                            .background(panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(viewModel.selectedHolobotName == holobot.name ? brightGold : brightGold.opacity(0.35), lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(10)
            }
        }
        .onAppear {
            viewModel.sanitizeSelectedHolobot(availableHolobots: connectivity.ownedHolobots)
            connectivity.requestSessionState()
        }
    }
}

private struct WorkoutSettingsView: View {
    @EnvironmentObject var viewModel: WorkoutViewModel
    @Environment(\.dismiss) private var dismiss

    private let gold = Color(red: 0.94, green: 0.75, blue: 0.08)
    private let brightGold = Color(red: 0.98, green: 0.80, blue: 0.10)
    private let darkBg = Color(red: 0.02, green: 0.03, blue: 0.04)
    private let panel = Color(red: 0.04, green: 0.05, blue: 0.06)
    private let cream = Color(red: 0.996, green: 0.945, blue: 0.878)

    var body: some View {
        ZStack {
            darkBg.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("SETTINGS")
                            .font(.system(size: 13, weight: .black))
                            .foregroundColor(brightGold)
                            .kerning(1.8)

                        Spacer()

                        Button("DONE") {
                            dismiss()
                        }
                        .font(.system(size: 11, weight: .black))
                        .foregroundColor(cream)
                        .buttonStyle(.plain)
                    }

                    Text("WORKOUT")
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundColor(brightGold.opacity(0.8))
                        .kerning(1.3)

                    VStack(spacing: 6) {
                        modeButton(
                            mode: .outdoorWalk,
                            title: "Outdoor Walk",
                            subtitle: "GPS + walk tracking",
                            icon: .outdoorWalk
                        )

                        modeButton(
                            mode: .treadmill,
                            title: "Treadmill",
                            subtitle: "Indoor arm-swing tracking",
                            icon: .treadmill
                        )
                    }

                    if viewModel.isRunning {
                        Text("Workout mode is locked while a session is running.")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(cream.opacity(0.7))
                    }

                    Text("UNITS")
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundColor(brightGold.opacity(0.8))
                        .kerning(1.3)
                        .padding(.top, 4)

                    HStack(spacing: 6) {
                        unitButton(unit: .kilometers, title: "KM")
                        unitButton(unit: .miles, title: "MI")
                    }
                }
                .padding(10)
            }
        }
    }

    private func modeButton(
        mode: WorkoutViewModel.WorkoutMode,
        title: String,
        subtitle: String,
        icon: WorkoutSettingsIcon
    ) -> some View {
        let selected = viewModel.workoutMode == mode

        return Button(action: {
            guard !viewModel.isRunning else { return }
            viewModel.workoutMode = mode
        }) {
            HStack(spacing: 8) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(selected ? gold.opacity(0.2) : Color.black.opacity(0.15))
                    workoutSettingsIcon(icon, color: selected ? brightGold : cream)
                        .frame(width: 18, height: 18)
                }
                .frame(width: 34, height: 34)

                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(size: 11, weight: .black))
                        .foregroundColor(cream)
                    Text(subtitle)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(cream.opacity(0.66))
                }

                Spacer()

                Circle()
                    .fill(selected ? brightGold : Color.clear)
                    .overlay(Circle().stroke(brightGold.opacity(0.6), lineWidth: 1))
                    .frame(width: 14, height: 14)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(selected ? brightGold : gold.opacity(0.2), lineWidth: 0.8)
            )
        }
        .buttonStyle(.plain)
        .disabled(viewModel.isRunning)
    }

    private func unitButton(unit: WorkoutViewModel.DistanceUnit, title: String) -> some View {
        let selected = viewModel.distanceUnit == unit

        return Button(action: {
            viewModel.distanceUnit = unit
        }) {
            Text(title)
                .font(.system(size: 12, weight: .black))
                .foregroundColor(selected ? darkBg : cream)
                .frame(maxWidth: .infinity)
                .frame(height: 30)
                .background(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(selected ? brightGold : panel)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .stroke(brightGold.opacity(selected ? 0 : 0.35), lineWidth: 0.8)
                )
        }
        .buttonStyle(.plain)
    }

}

private enum WorkoutSettingsIcon {
    case outdoorWalk
    case treadmill
}

@ViewBuilder
private func workoutSettingsIcon(_ icon: WorkoutSettingsIcon, color: Color) -> some View {
    switch icon {
    case .outdoorWalk:
        OutdoorWalkGlyph(color: color)
    case .treadmill:
        TreadmillGlyph(color: color)
    }
}

private struct SettingsGlyph: View {
    let color: Color

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height

            ZStack {
                Path { path in
                    path.move(to: CGPoint(x: w * 0.4302, y: h * 0.1799))
                    path.addCurve(to: CGPoint(x: w * 0.5698, y: h * 0.1799), control1: CGPoint(x: w * 0.4479, y: h * 0.0335), control2: CGPoint(x: w * 0.5521, y: h * 0.0335))
                    path.addCurve(to: CGPoint(x: w * 0.6770, y: h * 0.2688), control1: CGPoint(x: w * 0.6134, y: h * 0.1799), control2: CGPoint(x: w * 0.6484, y: h * 0.2243))
                    path.addCurve(to: CGPoint(x: w * 0.8393, y: h * 0.2243), control1: CGPoint(x: w * 0.7413, y: h * 0.1904), control2: CGPoint(x: w * 0.8143, y: h * 0.1528))
                    path.addCurve(to: CGPoint(x: w * 0.9380, y: h * 0.3230), control1: CGPoint(x: w * 0.9035, y: h * 0.2884), control2: CGPoint(x: w * 0.9403, y: h * 0.3619))
                    path.addCurve(to: CGPoint(x: w * 0.8936, y: h * 0.4854), control1: CGPoint(x: w * 0.8976, y: h * 0.3850), control2: CGPoint(x: w * 0.8630, y: h * 0.4379))
                    path.addCurve(to: CGPoint(x: w * 0.9825, y: h * 0.5922), control1: CGPoint(x: w * 0.9380, y: h * 0.5289), control2: CGPoint(x: w * 0.9825, y: h * 0.5639))
                    path.addCurve(to: CGPoint(x: w * 0.8936, y: h * 0.7312), control1: CGPoint(x: w * 0.9825, y: h * 0.6358), control2: CGPoint(x: w * 0.9380, y: h * 0.7022))
                    path.addCurve(to: CGPoint(x: w * 0.8393, y: h * 0.8201), control1: CGPoint(x: w * 0.8630, y: h * 0.7957), control2: CGPoint(x: w * 0.8143, y: h * 0.8473))
                    path.addCurve(to: CGPoint(x: w * 0.6770, y: h * 0.7757), control1: CGPoint(x: w * 0.7413, y: h * 0.8098), control2: CGPoint(x: w * 0.6890, y: h * 0.7633))
                    path.addCurve(to: CGPoint(x: w * 0.5698, y: h * 0.8646), control1: CGPoint(x: w * 0.6484, y: h * 0.8201), control2: CGPoint(x: w * 0.6134, y: h * 0.8646))
                    path.addCurve(to: CGPoint(x: w * 0.4302, y: h * 0.8646), control1: CGPoint(x: w * 0.5521, y: h * 1.0110), control2: CGPoint(x: w * 0.4479, y: h * 1.0110))
                    path.addCurve(to: CGPoint(x: w * 0.3230, y: h * 0.7757), control1: CGPoint(x: w * 0.3866, y: h * 0.8646), control2: CGPoint(x: w * 0.3516, y: h * 0.8201))
                    path.addCurve(to: CGPoint(x: w * 0.1607, y: h * 0.8201), control1: CGPoint(x: w * 0.2587, y: h * 0.8098), control2: CGPoint(x: w * 0.1857, y: h * 0.8473))
                    path.addCurve(to: CGPoint(x: w * 0.0620, y: h * 0.7214), control1: CGPoint(x: w * 0.0965, y: h * 0.7560), control2: CGPoint(x: w * 0.0597, y: h * 0.6824))
                    path.addCurve(to: CGPoint(x: w * 0.1064, y: h * 0.5589), control1: CGPoint(x: w * 0.1024, y: h * 0.6594), control2: CGPoint(x: w * 0.1370, y: h * 0.6064))
                    path.addCurve(to: CGPoint(x: w * 0.0175, y: h * 0.4520), control1: CGPoint(x: w * 0.0620, y: h * 0.5154), control2: CGPoint(x: w * 0.0175, y: h * 0.4804))
                    path.addCurve(to: CGPoint(x: w * 0.1064, y: h * 0.3130), control1: CGPoint(x: w * 0.0175, y: h * 0.4084), control2: CGPoint(x: w * 0.0620, y: h * 0.3420))
                    path.addCurve(to: CGPoint(x: w * 0.1607, y: h * 0.2243), control1: CGPoint(x: w * 0.1370, y: h * 0.2485), control2: CGPoint(x: w * 0.1857, y: h * 0.1969))
                    path.addCurve(to: CGPoint(x: w * 0.3230, y: h * 0.2688), control1: CGPoint(x: w * 0.2587, y: h * 0.2347), control2: CGPoint(x: w * 0.3110, y: h * 0.2812))
                    path.addCurve(to: CGPoint(x: w * 0.4302, y: h * 0.1799), control1: CGPoint(x: w * 0.3516, y: h * 0.2243), control2: CGPoint(x: w * 0.3866, y: h * 0.1799))
                }
                .stroke(color, style: StrokeStyle(lineWidth: max(1.2, w * 0.10), lineCap: .round, lineJoin: .round))

                Circle()
                    .stroke(color, lineWidth: max(1.2, w * 0.10))
                    .frame(width: w * 0.30, height: h * 0.30)
            }
        }
    }
}

private struct OutdoorWalkGlyph: View {
    let color: Color

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height

            Path { path in
                path.move(to: CGPoint(x: w * 0.5417, y: h * 0.9167))
                path.addLine(to: CGPoint(x: w * 0.5417, y: h * 0.7083))
                path.addLine(to: CGPoint(x: w * 0.4542, y: h * 0.6250))
                path.addLine(to: CGPoint(x: w * 0.4219, y: h * 0.7688))
                path.addCurve(to: CGPoint(x: w * 0.4037, y: h * 0.7945), control1: CGPoint(x: w * 0.4177, y: h * 0.7854), control2: CGPoint(x: w * 0.4056, y: h * 0.7943))
                path.addCurve(to: CGPoint(x: w * 0.3729, y: h * 0.8001), control1: CGPoint(x: w * 0.3897, y: h * 0.8031), control2: CGPoint(x: w * 0.3788, y: h * 0.8012))
                path.addLine(to: CGPoint(x: w * 0.1667, y: h * 0.7583))
                path.addCurve(to: CGPoint(x: w * 0.1396, y: h * 0.7318), control1: CGPoint(x: w * 0.1490, y: h * 0.7552), control2: CGPoint(x: w * 0.1396, y: h * 0.7431))
                path.addCurve(to: CGPoint(x: w * 0.1543, y: h * 0.6908), control1: CGPoint(x: w * 0.1396, y: h * 0.7083), control2: CGPoint(x: w * 0.1460, y: h * 0.6977))
                path.addCurve(to: CGPoint(x: w * 0.1865, y: h * 0.6784), control1: CGPoint(x: w * 0.1642, y: h * 0.6851), control2: CGPoint(x: w * 0.1752, y: h * 0.6813))
                path.addLine(to: CGPoint(x: w * 0.3458, y: h * 0.7117))
                path.addLine(to: CGPoint(x: w * 0.4125, y: h * 0.3750))
                path.addLine(to: CGPoint(x: w * 0.3375, y: h * 0.4042))
                path.addLine(to: CGPoint(x: w * 0.3375, y: h * 0.5000))
                path.addCurve(to: CGPoint(x: w * 0.3255, y: h * 0.5297), control1: CGPoint(x: w * 0.3375, y: h * 0.5110), control2: CGPoint(x: w * 0.3325, y: h * 0.5219))
                path.addCurve(to: CGPoint(x: w * 0.2917, y: h * 0.5417), control1: CGPoint(x: w * 0.3169, y: h * 0.5383), control2: CGPoint(x: w * 0.3057, y: h * 0.5417))
                path.addCurve(to: CGPoint(x: w * 0.2563, y: h * 0.5297), control1: CGPoint(x: w * 0.2777, y: h * 0.5417), control2: CGPoint(x: w * 0.2657, y: h * 0.5384))
                path.addCurve(to: CGPoint(x: w * 0.2500, y: h * 0.5000), control1: CGPoint(x: w * 0.2517, y: h * 0.5217), control2: CGPoint(x: w * 0.2500, y: h * 0.5090))
                path.addLine(to: CGPoint(x: w * 0.2500, y: h * 0.3729))
                path.addCurve(to: CGPoint(x: w * 0.2636, y: h * 0.3505), control1: CGPoint(x: w * 0.2500, y: h * 0.3604), control2: CGPoint(x: w * 0.2568, y: h * 0.3528))
                path.addCurve(to: CGPoint(x: w * 0.4021, y: h * 0.2901), control1: CGPoint(x: w * 0.3120, y: h * 0.3295), control2: CGPoint(x: w * 0.3675, y: h * 0.3047))
                path.addCurve(to: CGPoint(x: w * 0.4771, y: h * 0.2865), control1: CGPoint(x: w * 0.4233, y: h * 0.2811), control2: CGPoint(x: w * 0.4433, y: h * 0.2819))
                path.addCurve(to: CGPoint(x: w * 0.5333, y: h * 0.3438), control1: CGPoint(x: w * 0.5105, y: h * 0.2910), control2: CGPoint(x: w * 0.5270, y: h * 0.3038))
                path.addLine(to: CGPoint(x: w * 0.5750, y: h * 0.4104))
                path.addCurve(to: CGPoint(x: w * 0.6889, y: h * 0.4719), control1: CGPoint(x: w * 0.5969, y: h * 0.4458), control2: CGPoint(x: w * 0.6477, y: h * 0.4759))
                path.addCurve(to: CGPoint(x: w * 0.7500, y: h * 0.5000), control1: CGPoint(x: w * 0.7067, y: h * 0.4750), control2: CGPoint(x: w * 0.7292, y: h * 0.4813))
                path.addCurve(to: CGPoint(x: w * 0.7380, y: h * 0.5292), control1: CGPoint(x: w * 0.7500, y: h * 0.5177), control2: CGPoint(x: w * 0.7433, y: h * 0.5270))
                path.addCurve(to: CGPoint(x: w * 0.7083, y: h * 0.5417), control1: CGPoint(x: w * 0.7297, y: h * 0.5373), control2: CGPoint(x: w * 0.7183, y: h * 0.5417))
                path.addCurve(to: CGPoint(x: w * 0.6370, y: h * 0.5118), control1: CGPoint(x: w * 0.6521, y: h * 0.5333), control2: CGPoint(x: w * 0.6130, y: h * 0.5067))
                path.addLine(to: CGPoint(x: w * 0.5417, y: h * 0.3927))
                path.addLine(to: CGPoint(x: w * 0.4917, y: h * 0.6427))
                path.addLine(to: CGPoint(x: w * 0.5667, y: h * 0.7135))
                path.addCurve(to: CGPoint(x: w * 0.5833, y: h * 0.7440), control1: CGPoint(x: w * 0.5792, y: h * 0.7250), control2: CGPoint(x: w * 0.5833, y: h * 0.7304))
                path.addLine(to: CGPoint(x: w * 0.5833, y: h * 0.9167))
                path.addCurve(to: CGPoint(x: w * 0.5713, y: h * 0.9464), control1: CGPoint(x: w * 0.5833, y: h * 0.9277), control2: CGPoint(x: w * 0.5783, y: h * 0.9386))
                path.addCurve(to: CGPoint(x: w * 0.5417, y: h * 0.9583), control1: CGPoint(x: w * 0.5627, y: h * 0.9550), control2: CGPoint(x: w * 0.5517, y: h * 0.9583))
                path.addCurve(to: CGPoint(x: w * 0.5120, y: h * 0.9463), control1: CGPoint(x: w * 0.5317, y: h * 0.9583), control2: CGPoint(x: w * 0.5206, y: h * 0.9550))
                path.addCurve(to: CGPoint(x: w * 0.5000, y: h * 0.9167), control1: CGPoint(x: w * 0.5034, y: h * 0.9377), control2: CGPoint(x: w * 0.5000, y: h * 0.9277))
                path.move(to: CGPoint(x: w * 0.5625, y: h * 0.1458))
                path.addCurve(to: CGPoint(x: w * 0.5037, y: h * 0.2871), control1: CGPoint(x: w * 0.5625, y: h * 0.2145), control2: CGPoint(x: w * 0.5363, y: h * 0.2871))
                path.addCurve(to: CGPoint(x: w * 0.4458, y: h * 0.1458), control1: CGPoint(x: w * 0.4712, y: h * 0.2871), control2: CGPoint(x: w * 0.4458, y: h * 0.2145))
                path.addCurve(to: CGPoint(x: w * 0.5047, y: h * 0.0625), control1: CGPoint(x: w * 0.4458, y: h * 0.1063), control2: CGPoint(x: w * 0.4715, y: h * 0.0625))
                path.addCurve(to: CGPoint(x: w * 0.5625, y: h * 0.1458), control1: CGPoint(x: w * 0.5378, y: h * 0.0625), control2: CGPoint(x: w * 0.5625, y: h * 0.1070))
            }
            .fill(color)
        }
    }
}

private struct TreadmillGlyph: View {
    let color: Color

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height

            Path { path in
                path.move(to: CGPoint(x: w * 0.4167, y: h * 0.1250))
                path.addCurve(to: CGPoint(x: w * 0.5000, y: h * 0.0417), control1: CGPoint(x: w * 0.3707, y: h * 0.1250), control2: CGPoint(x: w * 0.4167, y: h * 0.0877))
                path.addCurve(to: CGPoint(x: w * 0.5833, y: h * 0.1250), control1: CGPoint(x: w * 0.5833, y: h * 0.0877), control2: CGPoint(x: w * 0.6293, y: h * 0.1250))
                path.addCurve(to: CGPoint(x: w * 0.5000, y: h * 0.2083), control1: CGPoint(x: w * 0.5833, y: h * 0.1710), control2: CGPoint(x: w * 0.5460, y: h * 0.2083))
                path.addCurve(to: CGPoint(x: w * 0.4167, y: h * 0.1250), control1: CGPoint(x: w * 0.4540, y: h * 0.2083), control2: CGPoint(x: w * 0.4167, y: h * 0.1710))

                path.move(to: CGPoint(x: w * 0.1250, y: h * 0.5833))
                path.addLine(to: CGPoint(x: w * 0.2917, y: h * 0.6250))
                path.addLine(to: CGPoint(x: w * 0.3125, y: h * 0.6042))

                path.move(to: CGPoint(x: w * 0.5000, y: h * 0.7500))
                path.addLine(to: CGPoint(x: w * 0.5000, y: h * 0.6250))
                path.addLine(to: CGPoint(x: w * 0.3750, y: h * 0.5030))
                path.addLine(to: CGPoint(x: w * 0.4063, y: h * 0.2917))

                path.move(to: CGPoint(x: w * 0.2500, y: h * 0.4167))
                path.addLine(to: CGPoint(x: w * 0.2500, y: h * 0.3333))
                path.addLine(to: CGPoint(x: w * 0.4167, y: h * 0.2917))
                path.addLine(to: CGPoint(x: w * 0.5208, y: h * 0.3958))
                path.addLine(to: CGPoint(x: w * 0.6250, y: h * 0.4167))

                path.move(to: CGPoint(x: w * 0.8750, y: h * 0.9167))
                path.addCurve(to: CGPoint(x: w * 0.8333, y: h * 0.8750), control1: CGPoint(x: w * 0.8750, y: h * 0.8937), control2: CGPoint(x: w * 0.8563, y: h * 0.8750))
                path.addLine(to: CGPoint(x: w * 0.1667, y: h * 0.8750))
                path.addCurve(to: CGPoint(x: w * 0.1250, y: h * 0.9167), control1: CGPoint(x: w * 0.1437, y: h * 0.8750), control2: CGPoint(x: w * 0.1250, y: h * 0.8937))

                path.move(to: CGPoint(x: w * 0.7500, y: h * 0.8750))
                path.addLine(to: CGPoint(x: w * 0.7917, y: h * 0.4167))
                path.addLine(to: CGPoint(x: w * 0.8750, y: h * 0.3750))
            }
            .stroke(color, style: StrokeStyle(lineWidth: max(1.5, w * 0.10), lineCap: .round, lineJoin: .round))
        }
    }
}

private struct BrandedWorkoutBackground: View {
    let darkBg: Color
    let gold: Color
    let brightGold: Color

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [brightGold.opacity(0.96), gold.opacity(0.92), darkBg],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            GeometryReader { geo in
                let width = geo.size.width
                let height = geo.size.height

                Path { path in
                    path.move(to: CGPoint(x: -width * 0.1, y: height * 0.22))
                    path.addLine(to: CGPoint(x: width * 0.55, y: -height * 0.05))
                    path.addLine(to: CGPoint(x: width * 0.7, y: -height * 0.05))
                    path.addLine(to: CGPoint(x: width * 0.05, y: height * 0.28))
                    path.closeSubpath()
                }
                .fill(Color.black.opacity(0.10))

                Path { path in
                    path.move(to: CGPoint(x: width * 0.22, y: height))
                    path.addLine(to: CGPoint(x: width * 0.92, y: height * 0.45))
                    path.addLine(to: CGPoint(x: width, y: height * 0.45))
                    path.addLine(to: CGPoint(x: width * 0.35, y: height))
                    path.closeSubpath()
                }
                .fill(Color.black.opacity(0.14))
            }
        }
        .overlay(Color.black.opacity(0.18))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [Color.clear, darkBg.opacity(0.94)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(height: 120)
        }
    }
}

#Preview {
    ActiveWorkoutView()
        .environmentObject(WorkoutViewModel())
        .environmentObject(WatchConnectivityManager.shared)
}
