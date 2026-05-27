import Foundation
import HealthKit
import os

@MainActor
final class WorkoutManager: NSObject, ObservableObject {
  @Published private(set) var elapsedSeconds: TimeInterval = 0
  @Published private(set) var heartRate: Double = 0
  @Published private(set) var isRunning = false
  @Published private(set) var statusText = "Ready to track a Sync workout."

  private let healthStore = HKHealthStore()
  private let logger = Logger(subsystem: "fun.holobots.mobile.watchkitapp", category: "Workout")
  private var builder: HKLiveWorkoutBuilder?
  private var session: HKWorkoutSession?
  private var timer: Timer?
  private var workoutStartDate: Date?

  override init() {
    super.init()
    logger.info("WorkoutManager initialized")
  }

  var elapsedText: String {
    let seconds = Int(elapsedSeconds)
    return String(format: "%02d:%02d", seconds / 60, seconds % 60)
  }

  var heartRateText: String {
    heartRate > 0 ? String(format: "%.0f", heartRate) : "--"
  }

  func requestAuthorization() async {
    logger.info("Requesting HealthKit authorization")

    guard HKHealthStore.isHealthDataAvailable() else {
      logger.error("Health data is unavailable on this watch")
      statusText = "Health data is unavailable on this watch."
      return
    }

    let heartRate = HKQuantityType.quantityType(forIdentifier: .heartRate)!
    let energy = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
    let distance = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!
    let workout = HKObjectType.workoutType()

    do {
      try await healthStore.requestAuthorization(
        toShare: [workout],
        read: [heartRate, energy, distance, workout]
      )
      logger.info("HealthKit authorization request completed")
      statusText = "Ready to track a Sync workout."
    } catch {
      logger.error("HealthKit authorization failed: \(error.localizedDescription, privacy: .public)")
      statusText = "Health permission is needed for workout tracking."
    }
  }

  func toggleWorkout() {
    isRunning ? endWorkout() : startWorkout()
  }

  private func startWorkout() {
    logger.info("Starting workout")
    guard !isRunning else { return }

    let configuration = HKWorkoutConfiguration()
    configuration.activityType = .walking
    configuration.locationType = .outdoor

    do {
      let nextSession = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
      let nextBuilder = nextSession.associatedWorkoutBuilder()

      nextBuilder.dataSource = HKLiveWorkoutDataSource(
        healthStore: healthStore,
        workoutConfiguration: configuration
      )
      nextSession.delegate = self
      nextBuilder.delegate = self

      let startDate = Date()
      session = nextSession
      builder = nextBuilder
      workoutStartDate = startDate
      elapsedSeconds = 0
      heartRate = 0
      statusText = "Workout running."
      isRunning = true

      nextSession.startActivity(with: startDate)
      nextBuilder.beginCollection(withStart: startDate) { _, _ in }
      startTimer()
    } catch {
      logger.error("Unable to start workout: \(error.localizedDescription, privacy: .public)")
      statusText = "Unable to start workout."
      isRunning = false
    }
  }

  private func endWorkout() {
    guard isRunning else { return }

    logger.info("Ending workout")
    isRunning = false
    statusText = "Saving workout..."
    stopTimer()
    session?.end()
  }

  private func startTimer() {
    stopTimer()
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      Task { @MainActor in
        guard let self, let startDate = self.workoutStartDate else { return }
        self.elapsedSeconds = Date().timeIntervalSince(startDate)
      }
    }
  }

  private func stopTimer() {
    timer?.invalidate()
    timer = nil
  }

  private func resetWorkoutReferences() {
    builder = nil
    session = nil
    workoutStartDate = nil
  }
}

extension WorkoutManager: HKWorkoutSessionDelegate {
  nonisolated func workoutSession(
    _ workoutSession: HKWorkoutSession,
    didChangeTo toState: HKWorkoutSessionState,
    from fromState: HKWorkoutSessionState,
    date: Date
  ) {
    guard toState == .ended else { return }

    Task { @MainActor in
      logger.info("Workout session ended")
      builder?.endCollection(withEnd: date) { [weak self] _, _ in
        self?.builder?.finishWorkout { _, _ in
          Task { @MainActor in
            self?.statusText = "Workout saved."
            self?.resetWorkoutReferences()
          }
        }
      }
    }
  }

  nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    Task { @MainActor in
      logger.error("Workout session failed: \(error.localizedDescription, privacy: .public)")
      statusText = "Workout stopped unexpectedly."
      isRunning = false
      stopTimer()
      resetWorkoutReferences()
    }
  }
}

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
  nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

  nonisolated func workoutBuilder(
    _ workoutBuilder: HKLiveWorkoutBuilder,
    didCollectDataOf collectedTypes: Set<HKSampleType>
  ) {
    guard collectedTypes.contains(HKQuantityType.quantityType(forIdentifier: .heartRate)!) else {
      return
    }

    let statistics = workoutBuilder.statistics(for: HKQuantityType.quantityType(forIdentifier: .heartRate)!)
    let unit = HKUnit.count().unitDivided(by: .minute())
    let value = statistics?.mostRecentQuantity()?.doubleValue(for: unit) ?? 0

    Task { @MainActor in
      heartRate = value
    }
  }
}
