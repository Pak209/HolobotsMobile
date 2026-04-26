import Combine
import CoreMotion
import Foundation
import HealthKit
import SwiftUI
import WatchKit

@MainActor
final class WorkoutViewModel: ObservableObject {

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
        guard elapsedSeconds > 0 else {
            return (0, 0, 0)
        }
        return RewardCalculator.calculate(
            elapsedSeconds: elapsedSeconds,
            stepCount: stepCount,
            distanceKm: distanceKm
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

        let rewards = currentRewards
        let payload = WorkoutCompletePayload(
            elapsedSeconds:   elapsedSeconds,
            stepCount:        stepCount,
            distanceMeters:   distanceKm * 1000,
            syncPointsEarned: rewards.syncPoints,
            holosEarned:      rewards.holos,
            expEarned:        rewards.exp,
            date:             localDateKey()
        )

        syncStatus = .sending
        presentLocalRewardsFallback(rewards: rewards)
        WatchConnectivityManager.shared.sendWorkoutComplete(payload)
    }

    // Called by WatchConnectivityManager when phone replies
    func applyRewards(_ rewards: WorkoutRewardsPayload) {
        syncStatus        = .success
        rewardsPayload    = rewards
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
        collectRewards()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            self?.start()
        }
    }

    func resetWorkout() {
        stopTimer()
        stopPedometer()
        elapsedSeconds = 0
        stepCount      = 0
        distanceKm     = 0
        speedKmh       = 0
        isRunning      = false
        syncStatus     = .idle
        timerFired     = false
        usedLocalRewardFallback = false
    }

    private func presentLocalRewardsFallback(
        rewards: (syncPoints: Int, holos: Int, exp: Int)
    ) {
        let completed = min(sessionsCompleted + 1, WorkoutConfig.maxDailySessions)
        let remaining = max(WorkoutConfig.maxDailySessions - completed, 0)
        let fallback = WorkoutRewardsPayload(
            syncPoints: rewards.syncPoints,
            holos: rewards.holos,
            exp: rewards.exp,
            sessionsCompleted: completed,
            sessionsRemaining: remaining,
            totalSyncPoints: totalSyncPoints + rewards.syncPoints
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
                self.stepCount = Int(truncating: data.numberOfSteps)
                if let dist = data.distance {
                    self.distanceKm = dist.doubleValue / 1000
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
