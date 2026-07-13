import Foundation
import WatchConnectivity

/// Authoritative daily workout counts pushed from the phone (which mirrors
/// the server's fitness_daily doc). Keyed by local date so a stale push from
/// yesterday can never overwrite today's counts.
struct DailySessionState: Equatable {
    let date: String
    let sessionsCompleted: Int
    let sessionsRemaining: Int
}

@MainActor
final class WatchConnectivityManager: NSObject, ObservableObject {

    static let shared = WatchConnectivityManager()

    @Published var incomingRewards: WorkoutRewardsPayload? = nil
    @Published var isPhoneReachable: Bool = false
    @Published var ownedHolobots: [WatchHolobot] = []
    @Published var dailySessionState: DailySessionState? = nil

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

    private func applySessionStatePayload(_ payload: [String: Any]) {
        applyOwnedHolobotNames(payload["ownedHolobotNames"] as? [Any])

        if let date = payload["dailyDate"] as? String,
           let completed = payload["sessionsCompleted"] as? Int {
            let remaining = payload["sessionsRemaining"] as? Int
                ?? max(0, WorkoutConfig.maxDailySessions - completed)
            dailySessionState = DailySessionState(
                date: date,
                sessionsCompleted: max(0, min(WorkoutConfig.maxDailySessions, completed)),
                sessionsRemaining: max(0, min(WorkoutConfig.maxDailySessions, remaining))
            )
        }
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
                    self?.applySessionStatePayload(reply)
                }
            },
            errorHandler: { error in
                print("[Watch] requestState error: \(error)")
            }
        )
    }

    /// Queue a claim for guaranteed delivery without waiting on a reply —
    /// used when a live claim timed out so the payout still lands later.
    func queueWorkoutClaim(_ payload: WorkoutCompletePayload) {
        guard WCSession.isSupported() else { return }
        WCSession.default.transferUserInfo(payload.asClaimDictionary)
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
            self.applySessionStatePayload(applicationContext)
        }
    }

    // Phone → Watch: push rewards after processing
    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any]
    ) {
        if message["type"] as? String == WatchMessageType.sessionState {
            Task { @MainActor in
                self.applySessionStatePayload(message)
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
                self.applySessionStatePayload(userInfo)
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
