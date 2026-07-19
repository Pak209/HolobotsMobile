import Foundation
import React
import WatchConnectivity

@objc public class WatchBridge: NSObject {
  @objc public static let shared = WatchBridge()

  private let ownedHolobotsKey = "holobots.watch.ownedHolobotNames"
  private let pendingEventsKey = "holobots.watch.pendingWorkoutEvents"
  private let dailySessionStateKey = "holobots.watch.dailySessionState"
  private var pendingReplies: [String: ([String: Any]) -> Void] = [:]
  private var pendingWorkoutEvents: [[String: Any]]
  private var lastSyncedOwnedHolobotNames: [String]
  // Last known authoritative daily workout counts (mirrors fitness_daily):
  // ["dailyDate": "yyyy-mm-dd", "sessionsCompleted": Int, "sessionsRemaining": Int]
  private var lastDailySessionState: [String: Any]
  // This phone's workout presence (soft cross-device lock). Rides INSIDE the
  // sessionState payload so it shares the counts channel instead of racing it.
  private var lastPhonePresence: [String: Any]?
  // Latest presence broadcast from the watch, relayed to JS.
  private var latestWatchPresence: [String: Any]?

  private override init() {
    lastSyncedOwnedHolobotNames = UserDefaults.standard.array(forKey: ownedHolobotsKey) as? [String] ?? []
    pendingWorkoutEvents = UserDefaults.standard.array(forKey: pendingEventsKey) as? [[String: Any]] ?? []
    lastDailySessionState = UserDefaults.standard.dictionary(forKey: dailySessionStateKey) ?? [:]
    super.init()
  }

  private func sessionStatePayload() -> [String: Any] {
    var payload: [String: Any] = [
      "type": "sessionState",
      "ownedHolobotNames": lastSyncedOwnedHolobotNames,
    ]
    for (key, value) in lastDailySessionState {
      payload[key] = value
    }
    if let lastPhonePresence {
      payload["workoutPresence"] = lastPhonePresence
    }
    return payload
  }

  func syncWorkoutPresence(_ presence: [String: Any]) {
    guard let workoutActive = presence["workoutActive"] as? Bool else { return }
    lastPhonePresence = [
      "device": "phone",
      "workoutActive": workoutActive,
      "startedAtMs": (presence["startedAtMs"] as? NSNumber)?.doubleValue ?? 0,
      "expiresAtMs": (presence["expiresAtMs"] as? NSNumber)?.doubleValue ?? 0,
    ]
    pushSessionState()
  }

  func getWatchWorkoutPresence() -> [String: Any]? {
    if let latestWatchPresence {
      return latestWatchPresence
    }
    // Cold start: the watch's application context persists across phone app
    // launches, so a workout started while this app was closed is still seen.
    guard WCSession.isSupported() else { return nil }
    let context = WCSession.default.receivedApplicationContext
    guard context["type"] as? String == "workoutPresence" else { return nil }
    return context
  }

  private func handleWatchPresence(_ payload: [String: Any]) {
    guard payload["device"] as? String == "watch" else { return }
    latestWatchPresence = payload
    if let module = WatchBridgeModule.shared, module.hasListeners {
      module.sendEvent(withName: "watchWorkoutPresence", body: payload)
    }
  }

  private func pushSessionState() {
    guard WCSession.isSupported() else { return }

    let payload = sessionStatePayload()
    do {
      try WCSession.default.updateApplicationContext(payload)
    } catch {
      print("[WatchBridge] updateApplicationContext error: \(error)")
    }

    if WCSession.default.isReachable {
      WCSession.default.sendMessage(payload, replyHandler: nil)
    } else {
      WCSession.default.transferUserInfo(payload)
    }
  }

  func getPendingWatchWorkouts() -> [[String: Any]] {
    pendingWorkoutEvents.map { normalizeWorkoutPayload($0) }
  }

  private func persistPendingWorkoutEvents() {
    UserDefaults.standard.set(pendingWorkoutEvents, forKey: pendingEventsKey)
  }

  func ackWatchWorkout(workoutId: String) {
    pendingWorkoutEvents.removeAll { queuedEvent in
      let queuedWorkoutId =
        (queuedEvent["workoutId"] as? String) ??
        (queuedEvent["eventId"] as? String)
      return queuedWorkoutId == workoutId
    }
    persistPendingWorkoutEvents()
  }

  @objc public func activate() {
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  func sendRewardsToWatch(workoutId: String, rewards: [String: Any]) {
    if let reply = pendingReplies.removeValue(forKey: workoutId) {
      var replyPayload = rewards
      replyPayload["type"] = "workoutRewards"
      reply(replyPayload)
      return
    }

    guard WCSession.isSupported() else { return }
    var payload = rewards
    payload["type"] = "workoutRewards"

    if WCSession.default.isReachable {
      WCSession.default.sendMessage(payload, replyHandler: nil)
    } else {
      WCSession.default.transferUserInfo(payload)
    }
  }

  func syncOwnedHolobots(_ ownedHolobotNames: [String]) {
    let normalizedNames = Array(
      Set(
        ownedHolobotNames
          .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }
          .filter { !$0.isEmpty }
      )
    ).sorted()
    lastSyncedOwnedHolobotNames = normalizedNames
    UserDefaults.standard.set(normalizedNames, forKey: ownedHolobotsKey)
    pushSessionState()
  }

  func syncDailySessionState(_ state: [String: Any]) {
    guard let date = state["dailyDate"] as? String else { return }
    let sessionsCompleted = (state["sessionsCompleted"] as? NSNumber)?.intValue ?? 0
    let sessionsRemaining = (state["sessionsRemaining"] as? NSNumber)?.intValue
      ?? max(0, 4 - sessionsCompleted)

    lastDailySessionState = [
      "dailyDate": date,
      "sessionsCompleted": sessionsCompleted,
      "sessionsRemaining": sessionsRemaining,
    ]
    UserDefaults.standard.set(lastDailySessionState, forKey: dailySessionStateKey)
    pushSessionState()
  }

  private func normalizeWorkoutPayload(_ payload: [String: Any]) -> [String: Any] {
    let rawWorkoutId = (payload["workoutId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let rawEventId = (payload["eventId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let workoutId = !rawWorkoutId.isEmpty ? rawWorkoutId : (!rawEventId.isEmpty ? rawEventId : UUID().uuidString)

    let elapsedSeconds = payload["elapsedSeconds"] as? Int ?? 0
    let stepCount = payload["stepCount"] as? Int ?? 0
    let distanceMeters = payload["distanceMeters"] as? Double ?? 0
    let syncPointsEarned = payload["syncPointsEarned"] as? Int ?? 0
    let holosEarned = payload["holosEarned"] as? Int ?? 0
    let expEarned = payload["expEarned"] as? Int ?? 0
    let dateKey = payload["date"] as? String ?? UUID().uuidString

    return [
      "type": "watchWorkoutComplete",
      "workoutId": workoutId,
      "eventId": workoutId,
      "date": dateKey,
      "distanceMeters": distanceMeters,
      "elapsedSeconds": elapsedSeconds,
      "expEarned": expEarned,
      "hasReplyHandler": false,
      "holobotName": payload["holobotName"] as? String ?? "",
      "holosEarned": holosEarned,
      "stepCount": stepCount,
      "syncPointsEarned": syncPointsEarned,
    ]
  }

  private func handleWorkoutClaim(
    _ payload: [String: Any],
    replyHandler: (([String: Any]) -> Void)?
  ) {
    var bridgeEvent = normalizeWorkoutPayload(payload)
    let workoutId = bridgeEvent["workoutId"] as? String ?? UUID().uuidString
    if let replyHandler {
      pendingReplies[workoutId] = replyHandler
      bridgeEvent["hasReplyHandler"] = true
    }

    if !pendingWorkoutEvents.contains(where: { ($0["workoutId"] as? String) == workoutId }) {
      pendingWorkoutEvents.append(bridgeEvent)
      persistPendingWorkoutEvents()
    }

    if let module = WatchBridgeModule.shared, module.hasListeners {
      module.sendEvent(withName: "watchWorkoutComplete", body: bridgeEvent)
    }
  }
}

extension WatchBridge: WCSessionDelegate {
  public func session(
    _ session: WCSession,
    activationDidCompleteWith state: WCSessionActivationState,
    error: Error?
  ) {}

  public func sessionDidBecomeInactive(_ session: WCSession) {}

  public func sessionDidDeactivate(_ session: WCSession) {
    WCSession.default.activate()
  }

  public func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    if message["type"] as? String == "requestState" {
      replyHandler(sessionStatePayload())
      return
    }

    let messageType = message["type"] as? String
    guard
      messageType == "claimWorkoutRewards" ||
      messageType == "workoutComplete"
    else { return }
    handleWorkoutClaim(message, replyHandler: replyHandler)
  }

  // Watch presence arrives via reply-less messages (live) and application
  // context (queued) — neither touches the claim path above.
  public func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any]
  ) {
    guard message["type"] as? String == "workoutPresence" else { return }
    handleWatchPresence(message)
  }

  public func session(
    _ session: WCSession,
    didReceiveApplicationContext applicationContext: [String: Any]
  ) {
    guard applicationContext["type"] as? String == "workoutPresence" else { return }
    handleWatchPresence(applicationContext)
  }

  public func session(
    _ session: WCSession,
    didReceiveUserInfo userInfo: [String: Any] = [:]
  ) {
    if userInfo["type"] as? String == "workoutPresence" {
      handleWatchPresence(userInfo)
      return
    }

    let messageType = userInfo["type"] as? String
    guard
      messageType == "claimWorkoutRewards" ||
      messageType == "workoutComplete"
    else { return }
    handleWorkoutClaim(userInfo, replyHandler: nil)
  }
}

@objc(WatchBridgeModule)
class WatchBridgeModule: RCTEventEmitter {
  static weak var shared: WatchBridgeModule?
  fileprivate var hasListeners = false

  override init() {
    super.init()
    WatchBridgeModule.shared = self
  }

  override func supportedEvents() -> [String]! {
    ["watchWorkoutComplete", "watchWorkoutPresence"]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc func sendRewardsToWatch(_ eventId: String, rewards: NSDictionary) {
    WatchBridge.shared.sendRewardsToWatch(
      workoutId: eventId,
      rewards: rewards as? [String: Any] ?? [:]
    )
  }

  @objc func getPendingWatchWorkouts(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    resolve(WatchBridge.shared.getPendingWatchWorkouts())
  }

  @objc func ackWatchWorkout(_ workoutId: String) {
    WatchBridge.shared.ackWatchWorkout(workoutId: workoutId)
  }

  @objc func syncOwnedHolobots(_ ownedHolobotNames: [String]) {
    WatchBridge.shared.syncOwnedHolobots(ownedHolobotNames)
  }

  @objc func syncDailySessionState(_ state: NSDictionary) {
    WatchBridge.shared.syncDailySessionState(state as? [String: Any] ?? [:])
  }

  @objc func syncWorkoutPresence(_ presence: NSDictionary) {
    WatchBridge.shared.syncWorkoutPresence(presence as? [String: Any] ?? [:])
  }

  @objc func getWatchWorkoutPresence(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    resolve(WatchBridge.shared.getWatchWorkoutPresence())
  }
}
