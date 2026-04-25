import Foundation
import React
import WatchConnectivity

@objc public class WatchBridge: NSObject {
  @objc public static let shared = WatchBridge()

  private var pendingReplies: [String: ([String: Any]) -> Void] = [:]

  private override init() {
    super.init()
  }

  @objc public func activate() {
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  func sendRewardsToWatch(date: String, rewards: [String: Any]) {
    if let reply = pendingReplies.removeValue(forKey: date) {
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

  private func handleWorkoutComplete(
    _ payload: [String: Any],
    replyHandler: (([String: Any]) -> Void)?
  ) {
    let dateKey = payload["date"] as? String ?? UUID().uuidString
    if let replyHandler {
      pendingReplies[dateKey] = replyHandler
    }

    let bridgeEvent: [String: Any] = [
      "type": "watchWorkoutComplete",
      "date": dateKey,
      "distanceMeters": payload["distanceMeters"] as? Double ?? 0,
      "elapsedSeconds": payload["elapsedSeconds"] as? Int ?? 0,
      "expEarned": payload["expEarned"] as? Int ?? 0,
      "hasReplyHandler": replyHandler != nil,
      "holosEarned": payload["holosEarned"] as? Int ?? 0,
      "stepCount": payload["stepCount"] as? Int ?? 0,
      "syncPointsEarned": payload["syncPointsEarned"] as? Int ?? 0,
    ]

    WatchBridgeModule.shared?.sendEvent(withName: "watchWorkoutComplete", body: bridgeEvent)
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
    guard message["type"] as? String == "workoutComplete" else { return }
    handleWorkoutComplete(message, replyHandler: replyHandler)
  }

  public func session(
    _ session: WCSession,
    didReceiveUserInfo userInfo: [String: Any] = [:]
  ) {
    guard userInfo["type"] as? String == "workoutComplete" else { return }
    handleWorkoutComplete(userInfo, replyHandler: nil)
  }
}

@objc(WatchBridgeModule)
class WatchBridgeModule: RCTEventEmitter {
  static weak var shared: WatchBridgeModule?

  override init() {
    super.init()
    WatchBridgeModule.shared = self
  }

  override func supportedEvents() -> [String]! {
    ["watchWorkoutComplete"]
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc func sendRewardsToWatch(_ date: String, rewards: NSDictionary) {
    WatchBridge.shared.sendRewardsToWatch(
      date: date,
      rewards: rewards as? [String: Any] ?? [:]
    )
  }
}
