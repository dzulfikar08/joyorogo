import Foundation

// Checks targets/widget/StreakModel.swift against the TypeScript model.
//
//   swiftc -O targets/widget/StreakModel.swift targets/widget/StreakStore.swift widget-ios-check/main.swift -o /tmp/streak-check
//   /tmp/streak-check widget-ios-check/streak-vectors.json
//
// streak-vectors.json is written by `UPDATE_WIDGET_FILES=1 bun test src/lib/widgets/ios-streak.test.ts` from
// streak-model.ts / packages/i18n day-zone.ts, and bun test fails when it is stale. Runs on macOS (the iOS CI job) and on
// Linux with a Swift toolchain, since StreakModel.swift imports Foundation only.

struct ExpectedModel: Decodable {
    let kind: String
    let pose: String
    let count: Int?
    let titleKey: String?
    let lit: Bool
    let labelKey: String?
    let lineKey: String
    let gain: Bool
}

struct ModelVector: Decodable {
    let name: String
    let snapshot: StreakSnapshot
    let today: String
    let hour: Int
    let expected: ExpectedModel
}

struct DayVector: Decodable {
    let at: String
    let zone: String
    let day: String
}

struct TimelineVector: Decodable {
    let fromSeconds: Double
    let zone: String
    let days: Int
    let dates: [Double]
}

struct Vectors: Decodable {
    let models: [ModelVector]
    let days: [DayVector]
    let timelines: [TimelineVector]
}

var failures: [String] = []
func check(_ ok: Bool, _ message: @autoclosure () -> String) {
    if !ok { failures.append(message()) }
}

guard CommandLine.arguments.count == 2,
      let data = FileManager.default.contents(atPath: CommandLine.arguments[1]),
      let vectors = try? JSONDecoder().decode(Vectors.self, from: data) else {
    print("usage: streak-check streak-vectors.json")
    exit(2)
}

for vector in vectors.models {
    let m = streakModel(vector.snapshot, today: vector.today, hour: vector.hour)
    let e = vector.expected
    check(m.kind.rawValue == e.kind, "\(vector.name): kind \(m.kind.rawValue), want \(e.kind)")
    check(m.pose.rawValue == e.pose, "\(vector.name): pose \(m.pose.rawValue), want \(e.pose)")
    check(m.count == e.count, "\(vector.name): count \(String(describing: m.count)), want \(String(describing: e.count))")
    check(m.titleKey == e.titleKey, "\(vector.name): titleKey \(String(describing: m.titleKey)), want \(String(describing: e.titleKey))")
    check(m.lit == e.lit, "\(vector.name): lit \(m.lit), want \(e.lit)")
    check(m.labelKey == e.labelKey, "\(vector.name): labelKey \(String(describing: m.labelKey)), want \(String(describing: e.labelKey))")
    check(m.lineKey == e.lineKey, "\(vector.name): lineKey \(m.lineKey), want \(e.lineKey)")
    check(m.gain == e.gain, "\(vector.name): gain \(m.gain), want \(e.gain)")
}

let iso = ISO8601DateFormatter()
for vector in vectors.days {
    guard let at = iso.date(from: vector.at) else { failures.append("bad instant \(vector.at)"); continue }
    let got = dayString(at, zone: vector.zone)
    check(got == vector.day, "day at \(vector.at) in \(vector.zone): \(got), want \(vector.day)")
}

for vector in vectors.timelines {
    let from = Date(timeIntervalSince1970: vector.fromSeconds)
    // The phone's clock is the person's zone in these vectors (the phone is where the person is).
    let got = timelineDates(from: from, zone: vector.zone, days: vector.days, hourCalendar: calendar(in: vector.zone)).map { $0.timeIntervalSince1970 }
    check(got == vector.dates, "timeline from \(vector.fromSeconds) in \(vector.zone): \(got), want \(vector.dates)")
}

// Parts only Swift has.
check(epochDay("1970-01-01") == 0, "epochDay of the epoch")
check(epochDay("2026-10-23") == 20_749, "epochDay of 2026-10-23")
check(epochDay("not a date") == nil, "malformed day parses")
check(epochDay("2026-13-01") == nil, "month 13 parses")
check(StreakCopy.resolve("ms", preferred: ["en-US"]) == "ms", "stored language wins")
check(StreakCopy.resolve("fr", preferred: ["fr-FR", "in-ID"]) == "id", "legacy 'in' is Indonesian")
check(StreakCopy.resolve(nil, preferred: ["ms-MY", "en-US"]) == "ms", "device language")
check(StreakCopy.resolve(nil, preferred: ["fr-FR"]) == "id", "unsupported device language falls back to Indonesian")
let unknown = StreakSnapshot(v: 9, signedIn: true, day: StreakDay(zone: nil, streak: StreakStamp(days: 2, lastLoggedDate: "garbage", previousLoggedDate: nil), maternal: nil, gain: nil))
check(streakModel(unknown, today: "2026-10-23", hour: 9).kind == .fresh, "a malformed last day reads as no streak")
check(streakModel(nil, today: "2026-10-23", hour: 9).kind == .signedOut, "no snapshot reads as signed out")
let garbagePrevious = StreakSnapshot(v: 1, signedIn: true, day: StreakDay(zone: nil, streak: StreakStamp(days: 1, lastLoggedDate: "2026-10-23", previousLoggedDate: "garbage"), maternal: nil, gain: nil))
check(streakModel(garbagePrevious, today: "2026-10-23", hour: 9).pose == .cheer, "a malformed previous log is no comeback")

if failures.isEmpty {
    print("streak-check: \(vectors.models.count) models, \(vectors.days.count) days, \(vectors.timelines.count) timelines ok")
} else {
    for failure in failures.prefix(30) { print("FAIL \(failure)") }
    print("streak-check: \(failures.count) failures")
    exit(1)
}
