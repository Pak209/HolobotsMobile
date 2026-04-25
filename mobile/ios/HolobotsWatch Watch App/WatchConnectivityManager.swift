import Foundation
import WatchConnectivity

@MainActor
final class WatchConnectivityManager: NSObject, ObservableObject {

    static let shared = WatchConnectivityManager()

    @Published var incomingRewards: WorkoutRewardsPayload? = nil
    @Published var isPhoneReachable: Bool = false

    private override init() { super.init() }

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // ── Send workout completion to phone ──────────────────────────────────────
    func sendWorkoutComplete(_ payload: WorkoutCompletePayload) {
        guard WCSession.default.isReachable else {
            // Fall back to transferUserInfo (guaranteed delivery, no reply)
            WCSession.default.transferUserInfo(payload.asDictionary)
            return
        }

        WCSession.default.sendMessage(
            payload.asDictionary,
            replyHandler: { [weak self] reply in
                Task { @MainActor [weak self] in
                    if let rewards = WorkoutRewardsPayload(from: reply) {
                        self?.incomingRewards = rewards
                    }
                }
            },
            errorHandler: { error in
                print("[Watch] sendMessage error: \(error)")
                // Fallback: phone will process via transferUserInfo on next connection
                WCSession.default.transferUserInfo(payload.asDictionary)
            }
        )
    }
}

// ── WCSessionDelegate ─────────────────────────────────────────────────────────
extension WatchConnectivityManager: WCSessionDelegate {

    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith state: WCSessionActivationState,
        error: Error?
    ) {
        Task { @MainActor in
            self.isPhoneReachable = (state == .activated)
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in
            self.isPhoneReachable = session.isReachable
        }
    }

    // Phone → Watch: push rewards after processing
    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any]
    ) {
        guard message["type"] as? String == WatchMessageType.workoutRewards,
              let rewards = WorkoutRewardsPayload(from: message)
        else { return }
        Task { @MainActor in
            self.incomingRewards = rewards
        }
    }

    // Guaranteed delivery when phone was unreachable
    nonisolated func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String: Any]
    ) {
        guard userInfo["type"] as? String == WatchMessageType.workoutRewards,
              let rewards = WorkoutRewardsPayload(from: userInfo)
        else { return }
        Task { @MainActor in
            self.incomingRewards = rewards
        }
    }
}
