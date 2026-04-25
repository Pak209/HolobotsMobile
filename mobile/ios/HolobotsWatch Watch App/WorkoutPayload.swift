import Foundation

// ─────────────────────────────────────────────
// Constants — must stay in sync with useWorkout.ts
// ─────────────────────────────────────────────
enum WorkoutConfig {
    static let totalSeconds        = 300      // 5 min
    static let maxDailySessions    = 4
    static let cooldownSeconds     = 600      // 10 min
    static let baseSyncPoints      = 225
    static let holosPerKm          = 12.0
    static let expPerKm            = 280.0
    static let syncPointBoost      = 100      // per full km/mi
    static let stepsPerSyncPoint   = 1000
    static let kmToMiles           = 0.621371
}

// ─────────────────────────────────────────────
// Message types — watch ↔ phone
// ─────────────────────────────────────────────
enum WatchMessageType {
    static let workoutComplete = "workoutComplete"
    static let workoutPause    = "workoutPause"
    static let workoutRewards  = "workoutRewards"
    static let sessionState    = "sessionState"
    static let requestState    = "requestState"
}

struct WorkoutCompletePayload {
    let elapsedSeconds:   Int
    let stepCount:        Int
    let distanceMeters:   Double
    let syncPointsEarned: Int
    let holosEarned:      Int
    let expEarned:        Int
    let date:             String   // "yyyy-MM-dd"

    var asDictionary: [String: Any] {
        [
            "type":             WatchMessageType.workoutComplete,
            "elapsedSeconds":   elapsedSeconds,
            "stepCount":        stepCount,
            "distanceMeters":   distanceMeters,
            "syncPointsEarned": syncPointsEarned,
            "holosEarned":      holosEarned,
            "expEarned":        expEarned,
            "date":             date,
        ]
    }
}

struct WorkoutRewardsPayload {
    let syncPoints:        Int
    let holos:             Int
    let exp:               Int
    let sessionsCompleted: Int
    let sessionsRemaining: Int
    let totalSyncPoints:   Int

    init?(from dict: [String: Any]) {
        guard
            let sp  = dict["syncPoints"]        as? Int,
            let h   = dict["holos"]             as? Int,
            let e   = dict["exp"]               as? Int,
            let sc  = dict["sessionsCompleted"] as? Int,
            let sr  = dict["sessionsRemaining"] as? Int,
            let tsp = dict["totalSyncPoints"]   as? Int
        else { return nil }
        syncPoints        = sp
        holos             = h
        exp               = e
        sessionsCompleted = sc
        sessionsRemaining = sr
        totalSyncPoints   = tsp
    }

    init(
        syncPoints: Int,
        holos: Int,
        exp: Int,
        sessionsCompleted: Int,
        sessionsRemaining: Int,
        totalSyncPoints: Int
    ) {
        self.syncPoints = syncPoints
        self.holos = holos
        self.exp = exp
        self.sessionsCompleted = sessionsCompleted
        self.sessionsRemaining = sessionsRemaining
        self.totalSyncPoints = totalSyncPoints
    }
}

// ─────────────────────────────────────────────
// Reward calculation — mirrors calculateRewards() in useWorkout.ts
// ─────────────────────────────────────────────
struct RewardCalculator {
    static func calculate(
        elapsedSeconds: Int,
        stepCount: Int,
        distanceKm: Double
    ) -> (syncPoints: Int, holos: Int, exp: Int) {
        let progress           = min(Double(elapsedSeconds) / Double(WorkoutConfig.totalSeconds), 1.0)
        let fullUnits          = Int(distanceKm)          // km milestones
        let distanceBonus      = fullUnits * WorkoutConfig.syncPointBoost
        let stepBonus          = stepCount / 25
        let syncPoints         = max(0, Int((progress * Double(WorkoutConfig.baseSyncPoints)).rounded()) + stepBonus + distanceBonus)
        let holos              = max(0, Int((distanceKm * WorkoutConfig.holosPerKm).rounded()))
        let exp                = max(0, Int((distanceKm * WorkoutConfig.expPerKm).rounded()))
        return (syncPoints, holos, exp)
    }
}

// ─────────────────────────────────────────────
// Date helper
// ─────────────────────────────────────────────
func localDateKey() -> String {
    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd"
    return fmt.string(from: Date())
}
