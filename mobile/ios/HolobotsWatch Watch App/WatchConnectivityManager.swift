import Foundation
import WatchConnectivity

@MainActor
final class WatchConnectivityManager: NSObject, ObservableObject {

    static let shared = WatchConnectivityManager()

    @Published var incomingRewards: WorkoutRewardsPayload? = nil
    @Published var isPhoneReachable: Bool = false
    @Published var ownedHolobots: [WatchHolobot] = []

    private static let ownedHolobotNamesKey = "holobots.watch.ownedHolobotNames"

    private override init() {
        if let storedNames = UserDefaults.standard.array(forKey: Self.ownedHolobotNamesKey) as? [String] {
            let resolved = storedNames
                .map(WatchHolobot.named(_:))
                .reduce(into: [WatchHolobot]()) { result, holobot in
                    if !result.contains(holobot) {
                        result.append(holobot)
                    }
                }
            self.ownedHolobots = resolved.isEmpty ? [WatchHolobot.defaultHolobot] : resolved
        } else {
            self.ownedHolobots = [WatchHolobot.defaultHolobot]
        }
        super.init()
    }

    private func applyOwnedHolobotNames(_ rawNames: [Any]?) {
        let resolved = (rawNames ?? [])
            .compactMap { $0 as? String }
            .map(WatchHolobot.named(_:))
            .reduce(into: [WatchHolobot]()) { result, holobot in
                if !result.contains(holobot) {
                    result.append(holobot)
                }
            }

        let nextHolobots = resolved.isEmpty ? [WatchHolobot.defaultHolobot] : resolved
        ownedHolobots = nextHolobots
        UserDefaults.standard.set(nextHolobots.map(\.name), forKey: Self.ownedHolobotNamesKey)
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func requestSessionState() {
        guard WCSession.isSupported(), WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(
            ["type": WatchMessageType.requestState],
            replyHandler: { [weak self] reply in
                Task { @MainActor [weak self] in
                    guard reply["type"] as? String == WatchMessageType.sessionState else { return }
                    self?.applyOwnedHolobotNames(reply["ownedHolobotNames"] as? [Any])
                }
            },
            errorHandler: { error in
                print("[Watch] requestState error: \(error)")
            }
        )
    }

    // ── Claim rewards on the phone ────────────────────────────────────────────
    func claimWorkoutRewards(_ payload: WorkoutCompletePayload) {
        guard WCSession.default.isReachable else {
            // Fall back to transferUserInfo (guaranteed delivery, no reply)
            WCSession.default.transferUserInfo(payload.asClaimDictionary)
            return
        }

        WCSession.default.sendMessage(
            payload.asClaimDictionary,
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
                WCSession.default.transferUserInfo(payload.asClaimDictionary)
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
            if state == .activated {
                self.requestSessionState()
            }
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in
            self.isPhoneReachable = session.isReachable
            if session.isReachable {
                self.requestSessionState()
            }
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveApplicationContext applicationContext: [String: Any]
    ) {
        guard applicationContext["type"] as? String == WatchMessageType.sessionState else { return }
        Task { @MainActor in
            self.applyOwnedHolobotNames(applicationContext["ownedHolobotNames"] as? [Any])
        }
    }

    // Phone → Watch: push rewards after processing
    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any]
    ) {
        if message["type"] as? String == WatchMessageType.sessionState {
            Task { @MainActor in
                self.applyOwnedHolobotNames(message["ownedHolobotNames"] as? [Any])
            }
            return
        }

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
        if userInfo["type"] as? String == WatchMessageType.sessionState {
            Task { @MainActor in
                self.applyOwnedHolobotNames(userInfo["ownedHolobotNames"] as? [Any])
            }
            return
        }

        guard userInfo["type"] as? String == WatchMessageType.workoutRewards,
              let rewards = WorkoutRewardsPayload(from: userInfo)
        else { return }
        Task { @MainActor in
            self.incomingRewards = rewards
        }
    }
}
