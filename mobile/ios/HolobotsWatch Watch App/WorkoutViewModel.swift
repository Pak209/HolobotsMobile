import Combine
import CoreMotion
import Foundation
import HealthKit
import SwiftUI
import WatchKit

@MainActor
final class WorkoutViewModel: ObservableObject {

    private struct RewardProgress {
        var syncPoints: Int = 0
        var holos: Int = 0
        var exp: Int = 0

        static let zero = RewardProgress()
    }

    enum WorkoutMode: String, CaseIterable, Identifiable {
        case outdoorWalk
        case treadmill

        var id: String { rawValue }
        var title: String {
            switch self {
            case .outdoorWalk: return "Outdoor Walk"
            case .treadmill: return "Treadmill"
            }
        }

        var isIndoor: Bool { self == .treadmill }
    }

    enum DistanceUnit: String, CaseIterable, Identifiable {
        case kilometers
        case miles

        var id: String { rawValue }
        var distanceSuffix: String {
            switch self {
            case .kilometers: return "km"
            case .miles: return "mi"
            }
        }

        var speedSuffix: String {
            switch self {
            case .kilometers: return "km/h"
            case .miles: return "mph"
            }
        }
    }

    // ── Live state ──────────────────────────────────────────────────────────
    @Published var elapsedSeconds: Int    = 0
    @Published var stepCount:      Int    = 0
    @Published var distanceKm:     Double = 0
    @Published var speedKmh:       Double = 0  // real-time from CMPedometer.currentPace
    @Published var isRunning:      Bool   = false

    // ── Session state ────────────────────────────────────────────────────────
    @Published var sessionsCompleted: Int  = 0
    @Published var sessionsRemaining: Int  = WorkoutConfig.maxDailySessions
    @Published var totalSyncPoints:   Int  = 0

    // ── UI state ─────────────────────────────────────────────────────────────
    @Published var showRewards:       Bool                   = false
    @Published var rewardsPayload:    WorkoutRewardsPayload? = nil
    @Published var syncStatus:        SyncStatus             = .idle
    @Published var workoutMode:       WorkoutMode            = .outdoorWalk {
        didSet {
            isIndoorMode = workoutMode.isIndoor
            UserDefaults.standard.set(workoutMode.rawValue, forKey: Self.workoutModeKey)
        }
    }
    @Published var distanceUnit:      DistanceUnit           = .kilometers {
        didSet {
            UserDefaults.standard.set(distanceUnit.rawValue, forKey: Self.distanceUnitKey)
        }
    }
    @Published var isIndoorMode:      Bool                   = false
    @Published var usedLocalRewardFallback: Bool             = false

    enum SyncStatus {
        case idle, sending, success, error
    }

    // ── Derived ──────────────────────────────────────────────────────────────
    var progress: Double {
        min(Double(elapsedSeconds) / Double(WorkoutConfig.totalSeconds), 1.0)
    }
    var remainingSeconds: Int {
        max(WorkoutConfig.totalSeconds - elapsedSeconds, 0)
    }
    var displayedDistance: Double {
        distanceUnit == .kilometers ? distanceKm : distanceKm * WorkoutConfig.kmToMiles
    }
    var displayedSpeed: Double {
        distanceUnit == .kilometers ? speedKmh : speedKmh * WorkoutConfig.kmToMiles
    }
    var distanceLabel: String {
        String(format: "%.2f %@", displayedDistance, distanceUnit.distanceSuffix)
    }
    var speedLabel: String {
        String(format: "%.0f %@", displayedSpeed, distanceUnit.speedSuffix)
    }
    var currentRewards: (syncPoints: Int, holos: Int, exp: Int) {
        let totalElapsed = accumulatedElapsedSeconds + elapsedSeconds
        let totalSteps = accumulatedStepCount + roundStepCount
        let totalDistance = accumulatedDistanceKm + roundDistanceKm

        guard totalElapsed > 0 else {
            return (0, 0, 0)
        }
        return RewardCalculator.calculate(
            elapsedSeconds: totalElapsed,
            stepCount: totalSteps,
            distanceKm: totalDistance
        )
    }
    var isComplete: Bool { elapsedSeconds >= WorkoutConfig.totalSeconds }

    // The watch gauge uses a tighter visible sweep than the original full semicircle.
    // Clamp the needle so 0 km/h lands on the left "zero" tick instead of rotating past it.
    var needleAngle: Angle {
        let maxDisplaySpeed = distanceUnit == .kilometers ? 18.0 : 18.0 * WorkoutConfig.kmToMiles
        let clamped = min(max(displayedSpeed, 0), maxDisplaySpeed)
        let minAngle = -162.0
        let maxAngle = -8.0
        return .degrees(minAngle + (clamped / maxDisplaySpeed) * (maxAngle - minAngle))
    }

    // ── Private ───────────────────────────────────────────────────────────────
    private var timer:           Timer?
    private let pedometer =      CMPedometer()
    private var pedometerStart:  Date?
    private var hkStore =        HKHealthStore()
    private var workoutSession:  HKWorkoutSession?
    private var workoutBuilder:  HKLiveWorkoutBuilder?
    private var timerFired =     false
    private var accumulatedElapsedSeconds = 0
    private var accumulatedStepCount = 0
    private var accumulatedDistanceKm = 0.0
    private var accumulatedRewards = RewardProgress.zero
    private var roundStepCount = 0
    private var roundDistanceKm = 0.0
    private static let workoutModeKey = "holobots.watch.workoutMode"
    private static let distanceUnitKey = "holobots.watch.distanceUnit"

    init() {
        if let storedMode = UserDefaults.standard.string(forKey: Self.workoutModeKey),
           let workoutMode = WorkoutMode(rawValue: storedMode) {
            self.workoutMode = workoutMode
            self.isIndoorMode = workoutMode.isIndoor
        } else {
            self.isIndoorMode = self.workoutMode.isIndoor
        }

        if let storedUnit = UserDefaults.standard.string(forKey: Self.distanceUnitKey),
           let distanceUnit = DistanceUnit(rawValue: storedUnit) {
            self.distanceUnit = distanceUnit
        }
    }

    // ── Start / Pause toggle ─────────────────────────────────────────────────
    func toggleRunning() {
        if isRunning { pause() } else { start() }
    }

    func start() {
        guard !isComplete else { return }
        isRunning = true
        timerFired = false
        startTimer()
        startPedometer()
        startHKWorkout(indoor: isIndoorMode)
    }

    func pause() {
        isRunning = false
        speedKmh  = 0  // needle drops to zero when paused
        stopTimer()
        stopPedometer()
        workoutSession?.pause()
    }

    // ── Finish early ─────────────────────────────────────────────────────────
    func finishNow() {
        guard !timerFired else { return }
        complete()
    }

    // ── Internal complete ─────────────────────────────────────────────────────
    private func complete() {
        timerFired = true
        isRunning  = false
        stopTimer()
        stopPedometer()
        endHKWorkout()

        accumulatedElapsedSeconds += elapsedSeconds
        accumulatedStepCount += roundStepCount
        accumulatedDistanceKm += roundDistanceKm

        let nextAccumulatedRewards = RewardCalculator.calculate(
            elapsedSeconds: accumulatedElapsedSeconds,
            stepCount: accumulatedStepCount,
            distanceKm: accumulatedDistanceKm
        )
        let segmentRewards = (
            syncPoints: max(0, nextAccumulatedRewards.syncPoints - accumulatedRewards.syncPoints),
            holos: max(0, nextAccumulatedRewards.holos - accumulatedRewards.holos),
            exp: max(0, nextAccumulatedRewards.exp - accumulatedRewards.exp)
        )
        accumulatedRewards = RewardProgress(
            syncPoints: nextAccumulatedRewards.syncPoints,
            holos: nextAccumulatedRewards.holos,
            exp: nextAccumulatedRewards.exp
        )

        stepCount = accumulatedStepCount
        distanceKm = accumulatedDistanceKm

        let payload = WorkoutCompletePayload(
            elapsedSeconds:   elapsedSeconds,
            stepCount:        roundStepCount,
            distanceMeters:   roundDistanceKm * 1000,
            syncPointsEarned: segmentRewards.syncPoints,
            holosEarned:      segmentRewards.holos,
            expEarned:        segmentRewards.exp,
            date:             localDateKey()
        )

        syncStatus = .sending
        presentLocalRewardsFallback(displayRewards: nextAccumulatedRewards, segmentRewards: segmentRewards)
        WatchConnectivityManager.shared.sendWorkoutComplete(payload)
    }

    // Called by WatchConnectivityManager when phone replies
    func applyRewards(_ rewards: WorkoutRewardsPayload) {
        syncStatus        = .success
        let displayRewards: WorkoutRewardsPayload
        if accumulatedRewards.syncPoints > rewards.syncPoints ||
            accumulatedRewards.holos > rewards.holos ||
            accumulatedRewards.exp > rewards.exp {
            displayRewards = WorkoutRewardsPayload(
                syncPoints: accumulatedRewards.syncPoints,
                holos: accumulatedRewards.holos,
                exp: accumulatedRewards.exp,
                sessionsCompleted: rewards.sessionsCompleted,
                sessionsRemaining: rewards.sessionsRemaining,
                totalSyncPoints: rewards.totalSyncPoints
            )
        } else {
            displayRewards = rewards
        }
        rewardsPayload    = displayRewards
        sessionsCompleted = rewards.sessionsCompleted
        sessionsRemaining = rewards.sessionsRemaining
        totalSyncPoints   = rewards.totalSyncPoints
        usedLocalRewardFallback = false
        showRewards       = true
        WKInterfaceDevice.current().play(.success)
    }

    // Dismiss rewards and reset for next session
    func collectRewards() {
        showRewards    = false
        rewardsPayload = nil
        resetWorkout()
    }

    func quickRefill() {
        showRewards    = false
        rewardsPayload = nil
        syncStatus     = .idle
        usedLocalRewardFallback = false
        prepareNextRound()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            self?.start()
        }
    }

    func resetWorkout() {
        stopTimer()
        stopPedometer()
        accumulatedElapsedSeconds = 0
        accumulatedStepCount = 0
        accumulatedDistanceKm = 0
        accumulatedRewards = .zero
        roundStepCount = 0
        roundDistanceKm = 0
        elapsedSeconds = 0
        stepCount      = 0
        distanceKm     = 0
        speedKmh       = 0
        isRunning      = false
        syncStatus     = .idle
        timerFired     = false
        usedLocalRewardFallback = false
    }

    private func prepareNextRound() {
        stopTimer()
        stopPedometer()
        roundStepCount = 0
        roundDistanceKm = 0
        elapsedSeconds = 0
        stepCount = accumulatedStepCount
        distanceKm = accumulatedDistanceKm
        speedKmh = 0
        isRunning = false
        syncStatus = .idle
        timerFired = false
    }

    private func presentLocalRewardsFallback(
        displayRewards: (syncPoints: Int, holos: Int, exp: Int),
        segmentRewards: (syncPoints: Int, holos: Int, exp: Int)
    ) {
        let completed = min(sessionsCompleted + 1, WorkoutConfig.maxDailySessions)
        let remaining = max(WorkoutConfig.maxDailySessions - completed, 0)
        let fallback = WorkoutRewardsPayload(
            syncPoints: displayRewards.syncPoints,
            holos: displayRewards.holos,
            exp: displayRewards.exp,
            sessionsCompleted: completed,
            sessionsRemaining: remaining,
            totalSyncPoints: totalSyncPoints + segmentRewards.syncPoints
        )

        rewardsPayload = fallback
        sessionsCompleted = completed
        sessionsRemaining = remaining
        totalSyncPoints = fallback.totalSyncPoints
        usedLocalRewardFallback = true
        showRewards = true
    }

    // ── Timer ─────────────────────────────────────────────────────────────────
    private func startTimer() {
        stopTimer()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.isRunning else { return }
                self.elapsedSeconds += 1
                if self.elapsedSeconds >= WorkoutConfig.totalSeconds {
                    self.complete()
                }
            }
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    // ── Pedometer (CMPedometer = steps + distance on watch) ──────────────────
    private func startPedometer() {
        guard CMPedometer.isStepCountingAvailable() else { return }
        let start = Date()
        pedometerStart = start
        pedometer.startUpdates(from: start) { [weak self] data, _ in
            guard let self, let data else { return }
            Task { @MainActor in
                self.roundStepCount = Int(truncating: data.numberOfSteps)
                self.stepCount = self.accumulatedStepCount + self.roundStepCount
                if let dist = data.distance {
                    self.roundDistanceKm = dist.doubleValue / 1000
                    self.distanceKm = self.accumulatedDistanceKm + self.roundDistanceKm
                }
                // currentPace = seconds per metre (nil when stationary)
                // Convert → km/h: (1 / pace_s_per_m) * 3.6
                if let pace = data.currentPace, pace.doubleValue > 0 {
                    let speedMs = 1.0 / pace.doubleValue
                    self.speedKmh = speedMs * 3.6
                } else {
                    self.speedKmh = 0
                }
            }
        }
    }

    private func stopPedometer() {
        pedometer.stopUpdates()
    }

    // ── HKWorkoutSession (so watch records a real workout) ────────────────────
    // indoor: true  → treadmill — uses wrist accelerometer for distance, no GPS
    // indoor: false → outdoor  — uses GPS when available, falls back to pedometer
    private func startHKWorkout(indoor: Bool = false) {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = .walking
        config.locationType = indoor ? .indoor : .outdoor

        do {
            let session = try HKWorkoutSession(healthStore: hkStore, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: hkStore, workoutConfiguration: config)
            workoutSession = session
            workoutBuilder = builder
            session.startActivity(with: Date())
            builder.beginCollection(withStart: Date()) { _, _ in }
        } catch {
            // HealthKit unavailable — pedometer still works
        }
    }

    private func endHKWorkout() {
        workoutSession?.end()
        workoutBuilder?.endCollection(withEnd: Date()) { [weak self] _, _ in
            self?.workoutBuilder?.finishWorkout { _, _ in }
        }
    }
}
