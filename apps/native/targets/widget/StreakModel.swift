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
    case cheer, milestone, welcome
    case morning, sideeye, panic, lastchance
    case teary, mopey, frozen, dusty, ghost
    case ready, relax
}

/// What the app keeps of a streak: the status follows from these two and the date it is read on.
struct StreakStamp: Decodable, Equatable {
    let days: Int
    let lastLoggedDate: String?
    /// The log before `lastLoggedDate`, kept by the app so a first log after a break reads as a comeback. Absent in old payloads.
    let previousLoggedDate: String?
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

/// Local hours at which an unlogged day gets more worried (12:00, 17:00, 21:00); the timeline has an entry at each.
let moodHours = [12, 17, 21]

/// A first log after at least this many days away is a comeback, not an ordinary day one.
let comebackAfterDays = 7

/// Run lengths that earn Joyo's party pose on the day they are reached: 7, 30, 100 and every further 100.
func isMilestone(_ days: Int) -> Bool {
    days == 7 || days == 30 || (days >= 100 && days % 100 == 0)
}

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
private let mopeyLines = ["misc:widget.streak.broken.mopey.1", "misc:widget.streak.broken.mopey.2", "misc:widget.streak.broken.mopey.3"]

/// The line for `date`: the same all day, a different one tomorrow.
private func rotate(_ lines: [String], _ date: String) -> String {
    let n = epochDay(date) ?? 0
    return lines[((n % lines.count) + lines.count) % lines.count]
}

/// Joyo's worry while the run is alive and today is blank, by the phone's local hour.
private func atRiskMood(_ hour: Int) -> (pose: StreakPose, lineKey: String) {
    if hour < moodHours[0] { return (.morning, "misc:widget.streak.atRisk.morning") }
    if hour < moodHours[1] { return (.sideeye, "misc:widget.streak.atRisk.sideeye") }
    if hour < moodHours[2] { return (.panic, "misc:widget.streak.atRisk.panic") }
    return (.lastchance, "misc:widget.streak.atRisk.lastchance")
}

/// Joyo's mood once the run is gone, by `lapseDays` (the count the tile shows: 2 is the first broken day). He counts
/// the days the run has been gone, so `lapseDays - 1`: 1 teary, 2-3 mopey, 4-6 frozen, 7-13 dusty, 14 and more ghost.
private func brokenMood(_ lapseDays: Int, _ today: String) -> (pose: StreakPose, lineKey: String) {
    let gone = lapseDays - 1
    if gone <= 1 { return (.teary, "misc:widget.streak.broken.teary") }
    if gone <= 3 { return (.mopey, rotate(mopeyLines, today)) }
    if gone <= 6 { return (.frozen, "misc:widget.streak.broken.frozen") }
    if gone <= 13 { return (.dusty, "misc:widget.streak.broken.dusty") }
    return (.ghost, "misc:widget.streak.broken.ghost")
}

/// The model for `snapshot` on the person's date `today` ('YYYY-MM-DD' in their zone) and the phone's local `hour`
/// (0-23). nil is a widget the app has not written to yet (just installed, app never opened): it reads as signed out,
/// "Buka JoyoRogo untuk masuk".
func streakModel(_ snapshot: StreakSnapshot?, today: String, hour: Int) -> StreakModel {
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
        var comeback = false
        if state.days == 1, let previous = stamp.previousLoggedDate, let gap = daysBetween(previous, today) {
            comeback = gap >= comebackAfterDays
        }
        var mood: (pose: StreakPose, lineKey: String) = (.cheer, rotate(doneLines, today))
        if comeback {
            mood = (.welcome, "misc:widget.streak.done.welcome")
        } else if isMilestone(state.days) {
            mood = (.milestone, "misc:widget.streak.done.milestone")
        }
        return StreakModel(kind: .done, pose: mood.pose, count: state.days, titleKey: nil, lit: true,
                           labelKey: "misc:widget.streak.days", lineKey: mood.lineKey, gain: gain)
    case .atRisk:
        let mood = atRiskMood(hour)
        return StreakModel(kind: .atRisk, pose: mood.pose, count: state.days, titleKey: nil, lit: true,
                           labelKey: "misc:widget.streak.days",
                           lineKey: gain ? "misc:widget.streak.atRisk.gain" : mood.lineKey, gain: gain)
    case .broken:
        let mood = brokenMood(state.lapseDays, today)
        return StreakModel(kind: .broken, pose: mood.pose, count: state.lapseDays, titleKey: nil,
                           lit: false, labelKey: gain ? "misc:widget.streak.lapseGain" : "misc:widget.streak.lapse",
                           lineKey: mood.lineKey, gain: gain)
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

func calendar(in zone: String?) -> Calendar {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = dayTimeZone(zone)
    return cal
}

/// The calendar day 'YYYY-MM-DD' it is in `zone` at `date`.
func dayString(_ date: Date, zone: String?) -> String {
    let c = calendar(in: zone).dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
}

/// The hour 0-23 it is at `date` on `calendar`: the phone's own clock (Calendar.current), which is what the mood follows.
func localHour(_ date: Date, calendar: Calendar = .current) -> Int {
    calendar.component(.hour, from: date)
}

/// `date` itself, then everything after it that can change the tile before the horizon (the `days`th midnight in
/// `zone`): each midnight, so a lit flame turns "at risk" at midnight and "broken" a day later, and each mood hour
/// (12:00, 17:00, 21:00 on `hourCalendar`, the phone's clock), so Joyo gets more worried at the hour. No network, no app launch.
func timelineDates(from date: Date, zone: String?, days: Int, hourCalendar: Calendar = .current) -> [Date] {
    let cal = calendar(in: zone)
    var midnights: [Date] = []
    var cursor = cal.startOfDay(for: date)
    for _ in 0..<days {
        guard let next = cal.date(byAdding: .day, value: 1, to: cursor) else { break }
        midnights.append(next)
        cursor = next
    }
    guard let horizon = midnights.last else { return [date] }

    var marks = Set(midnights)
    var dayStart = hourCalendar.startOfDay(for: date)
    while dayStart < horizon {
        for hour in moodHours {
            if let mark = hourCalendar.date(bySettingHour: hour, minute: 0, second: 0, of: dayStart),
               mark > date, mark < horizon {
                marks.insert(mark)
            }
        }
        guard let next = hourCalendar.date(byAdding: .day, value: 1, to: dayStart) else { break }
        dayStart = next
    }
    return [date] + marks.sorted()
}
