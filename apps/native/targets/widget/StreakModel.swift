import Foundation

// What the Streak Catat widget shows for a stored snapshot, as plain data. Foundation only (no SwiftUI/WidgetKit), so
// apps/native/widget-ios-check compiles this file on its own and checks it against the TypeScript model.
//
// This is a port of three TypeScript files, kept line for line where it can be:
//   - packages/api/src/lib/streak.ts           streakAt: done / at_risk / broken / none from a stamp and a date
//   - apps/native/src/lib/widgets/streak-model.ts   streakWidgetModel: kind, pose, number, copy keys
//   - apps/native/src/lib/widgets/ios-streak.ts     the JSON the app writes into the App Group
// streak-model.test.ts writes widget-ios-check/streak-vectors.json from the TypeScript model and the Swift check
// fails when this port answers differently, so the two cannot drift without a red build.
//
// A widget cannot fetch (iOS reloads it on its own budget), so the stamp is aged here on the phone's own date: a lit
// flame turns "at risk" at midnight and "broken" a day later without the app running.

enum StreakKind: String {
    case done, atRisk = "at_risk", broken, fresh, off, noTarget, signedOut
}

enum StreakPose: String, CaseIterable {
    case cheer, surprised, determined, sleepy, ready, relax
}

/// What the app keeps of a streak: the status follows from these two and the date it is read on.
struct StreakStamp: Decodable, Equatable {
    let days: Int
    let lastLoggedDate: String?
}

struct StreakDay: Decodable, Equatable {
    /// An IANA name the app serves (Asia/Jakarta, Asia/Kuala_Lumpur, Asia/Singapore). Absent in old snapshots.
    let zone: String?
    /// Null in Hamil / Menyusui (no streak pressure) and in snapshots written before the streak existed.
    let streak: StreakStamp?
    let maternal: Bool?
    let gain: Bool?
}

/// The App Group payload (key `streak`), written by apps/native/src/lib/widgets/ios-streak.ts.
struct StreakSnapshot: Decodable, Equatable {
    let v: Int?
    let signedIn: Bool
    /// Null: signed in without a plan yet.
    let day: StreakDay?
}

enum StreakStatus: Equatable {
    case done, atRisk, broken, none
}

struct StreakState: Equatable {
    let days: Int
    let status: StreakStatus
    let lapseDays: Int
}

struct StreakModel: Equatable {
    let kind: StreakKind
    let pose: StreakPose
    /// The big number beside the flame; nil shows no flame and `titleKey` takes its place.
    let count: Int?
    let titleKey: String?
    /// Lit orange flame (a log counts today or the run is alive) or a cold grey one.
    let lit: Bool
    let labelKey: String?
    let lineKey: String
    /// A Naikin BB plan counts days at the eating target, not days with a log: the copy says so.
    let gain: Bool
}

/// A week without a log: Joyo has dozed off instead of giving the look.
let sleepyAfterDays = 7

/// Days since 1970-01-01 of a 'YYYY-MM-DD' calendar day (proleptic Gregorian, pure integer math), nil when malformed.
func epochDay(_ ymd: String) -> Int? {
    let parts = ymd.split(separator: "-", omittingEmptySubsequences: false)
    guard parts.count == 3, let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
          (1...12).contains(month), (1...31).contains(day) else { return nil }
    let y = month <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yearOfEra = y - era * 400
    let dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
    let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
    return era * 146_097 + dayOfEra - 719_468
}

/// Calendar days from `from` to `to`, nil when either is malformed.
func daysBetween(_ from: String, _ to: String) -> Int? {
    guard let a = epochDay(from), let b = epochDay(to) else { return nil }
    return b - a
}

/// Status and lapse of a stamp on `today`: a lit flame turns "at risk" at midnight and "broken" a day later.
func streakAt(_ stamp: StreakStamp, today: String) -> StreakState {
    guard let last = stamp.lastLoggedDate, let gap = daysBetween(last, today) else {
        return StreakState(days: 0, status: .none, lapseDays: 0)
    }
    // A last day after today (the phone's clock behind the server's) reads as today.
    let lapse = max(0, gap)
    if lapse == 0 { return StreakState(days: stamp.days, status: .done, lapseDays: 0) }
    if lapse == 1 { return StreakState(days: stamp.days, status: .atRisk, lapseDays: 1) }
    return StreakState(days: 0, status: .broken, lapseDays: lapse)
}

private let doneLines = ["misc:widget.streak.done.1", "misc:widget.streak.done.2"]
private let atRiskLines = ["misc:widget.streak.atRisk.1", "misc:widget.streak.atRisk.2"]
private let brokenLines = ["misc:widget.streak.broken.1", "misc:widget.streak.broken.2", "misc:widget.streak.broken.3"]

/// The line for `date`: the same all day, a different one tomorrow.
private func rotate(_ lines: [String], _ date: String) -> String {
    let n = epochDay(date) ?? 0
    return lines[((n % lines.count) + lines.count) % lines.count]
}

/// The model for `snapshot` on the person's date `today` ('YYYY-MM-DD' in their zone). nil is a widget the app has
/// not written to yet (just installed, app never opened): it reads as signed out, "Buka JoyoRogo untuk masuk".
func streakModel(_ snapshot: StreakSnapshot?, today: String) -> StreakModel {
    guard let snapshot, snapshot.signedIn else {
        return StreakModel(kind: .signedOut, pose: .ready, count: nil, titleKey: "misc:widget.signIn", lit: false,
                           labelKey: nil, lineKey: "misc:widget.streak.signInLine", gain: false)
    }
    guard let day = snapshot.day else {
        return StreakModel(kind: .noTarget, pose: .ready, count: nil, titleKey: "misc:widget.streak.title", lit: false,
                           labelKey: nil, lineKey: "misc:widget.setTarget", gain: false)
    }
    guard day.maternal != true, let stamp = day.streak else {
        return StreakModel(kind: .off, pose: .relax, count: nil, titleKey: "misc:widget.photoCta", lit: false,
                           labelKey: nil, lineKey: "misc:widget.streak.off", gain: false)
    }

    let gain = day.gain == true
    let state = streakAt(stamp, today: today)
    switch state.status {
    case .done:
        return StreakModel(kind: .done, pose: .cheer, count: state.days, titleKey: nil, lit: true,
                           labelKey: "misc:widget.streak.days", lineKey: rotate(doneLines, today), gain: gain)
    case .atRisk:
        return StreakModel(kind: .atRisk, pose: .surprised, count: state.days, titleKey: nil, lit: true,
                           labelKey: "misc:widget.streak.days",
                           lineKey: gain ? "misc:widget.streak.atRisk.gain" : rotate(atRiskLines, today), gain: gain)
    case .broken:
        let asleep = state.lapseDays >= sleepyAfterDays
        return StreakModel(kind: .broken, pose: asleep ? .sleepy : .determined, count: state.lapseDays, titleKey: nil,
                           lit: false, labelKey: gain ? "misc:widget.streak.lapseGain" : "misc:widget.streak.lapse",
                           lineKey: asleep ? "misc:widget.streak.asleep" : rotate(brokenLines, today), gain: gain)
    case .none:
        return StreakModel(kind: .fresh, pose: .ready, count: nil, titleKey: "misc:widget.streak.freshTitle", lit: false,
                           labelKey: nil,
                           lineKey: gain ? "misc:widget.streak.freshGain" : "misc:widget.streak.fresh", gain: gain)
    }
}

// MARK: - Dates

/// Fixed offsets of the zones the product serves (none observes daylight saving), used when the system cannot resolve
/// the IANA name.
private func fixedOffsetSeconds(_ zone: String?) -> Int {
    switch zone {
    case "Asia/Kuala_Lumpur", "Asia/Singapore": return 8 * 3600
    default: return 7 * 3600
    }
}

func dayTimeZone(_ zone: String?) -> TimeZone {
    if let zone, let tz = TimeZone(identifier: zone) { return tz }
    return TimeZone(secondsFromGMT: fixedOffsetSeconds(zone)) ?? TimeZone(secondsFromGMT: 7 * 3600)!
}

private func calendar(in zone: String?) -> Calendar {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = dayTimeZone(zone)
    return cal
}

/// The calendar day 'YYYY-MM-DD' it is in `zone` at `date`.
func dayString(_ date: Date, zone: String?) -> String {
    let c = calendar(in: zone).dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
}

/// `date` itself, then the next `days` midnights in `zone`: one timeline entry per day, so the widget ages by itself
/// (a lit flame turns "at risk" at midnight) with no network and no app launch.
func timelineDates(from date: Date, zone: String?, days: Int) -> [Date] {
    let cal = calendar(in: zone)
    var dates = [date]
    var cursor = cal.startOfDay(for: date)
    for _ in 0..<days {
        guard let next = cal.date(byAdding: .day, value: 1, to: cursor) else { break }
        dates.append(next)
        cursor = next
    }
    return dates
}
