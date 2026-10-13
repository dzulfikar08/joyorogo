import ExpoModulesCore
import Foundation
import HealthKit

// Read-only HealthKit import for the iOS activity sync (US-013). Mirrors the
// Health Connect rules from apps/native/src/lib/health-connect.ts: cumulative
// sums come from HKStatisticsCollectionQuery anchored at WIB midnight, so a
// phone and an Apple Watch reporting the same walk count once. All overlap
// resolution and normalizing happens in the TS layer; this module only reads.
public class AppleHealthModule: Module {
  private static let readTypes: Set<HKSampleType> = [
    HKObjectType.workoutType(),
    HKQuantityType(.stepCount),
    HKQuantityType(.distanceWalkingRunning),
    HKQuantityType(.activeEnergyBurned),
    HKCategoryType(.sleepAnalysis),
  ]

  // One shared instance; init itself is safe on Health-less devices, every
  // call below is guarded by isHealthDataAvailable().
  private let store = HKHealthStore()

  // Fixed WIB (UTC+7) calendar, the same day rule as the server's
  // jakartaToday() and the JS wibDateOf() helper.
  private var wibCalendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 7 * 3600)!
    return calendar
  }

  public func definition() -> ModuleDefinition {
    Name("AppleHealth")

    AsyncFunction("isAvailable") {
      HKHealthStore.isHealthDataAvailable()
    }

    // Prompts once per install; HealthKit never reveals the answer. Callers
    // ask getRequestStatus() to learn whether the prompt was answered.
    AsyncFunction("requestAuthorization") { (promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.reject("ERR_UNAVAILABLE", "Apple Health tidak tersedia di perangkat ini.")
        return
      }
      self.store.requestAuthorization(toShare: nil, read: Self.readTypes) { _, error in
        if let error {
          promise.reject("ERR_AUTHORIZATION", error.localizedDescription)
        } else {
          promise.resolve(true)
        }
      }
    }

    // HKAuthorizationRequestStatus raw value: 0 notDetermined, 1 shouldRequest,
    // 2 unnecessary (the user already answered the prompt).
    AsyncFunction("getRequestStatus") { (promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.reject("ERR_UNAVAILABLE", "Apple Health tidak tersedia di perangkat ini.")
        return
      }
      self.store.getRequestStatusForAuthorization(toShare: [], read: Self.readTypes) { status, error in
        if let error {
          promise.reject("ERR_STATUS", error.localizedDescription)
        } else {
          promise.resolve(status.rawValue)
        }
      }
    }

    // Workouts between two epoch-ms bounds: uuid, HKWorkoutActivityType raw
    // value, start/end ISO strings, recorded active energy (kcal) and
    // distance (m) when the writing app stored them.
    AsyncFunction("getWorkouts") { (fromMs: Double, toMs: Double, promise: Promise) in
      Task {
        do {
          promise.resolve(try await self.readWorkouts(fromMs: fromMs, toMs: toMs))
        } catch {
          promise.reject("ERR_WORKOUTS", error.localizedDescription)
        }
      }
    }

    // Cumulative daily sums (steps, walking/running metres, active kcal) per
    // WIB calendar day, the HealthKit equivalent of Health Connect's
    // aggregateRecord(): the platform merges duplicate writing sources.
    AsyncFunction("getDailyTotals") { (fromMs: Double, toMs: Double, promise: Promise) in
      Task {
        do {
          promise.resolve(try await self.readDailyTotals(fromMs: fromMs, toMs: toMs))
        } catch {
          promise.reject("ERR_DAILY_TOTALS", error.localizedDescription)
        }
      }
    }

    // Raw sleepAnalysis category samples in the range (start, end ISO, value);
    // stage values 1/3/4/5 are asleep, 0 inBed and 2 awake are not.
    AsyncFunction("getSleepSamples") { (fromMs: Double, toMs: Double, promise: Promise) in
      Task {
        do {
          promise.resolve(try await self.readSleepSamples(fromMs: fromMs, toMs: toMs))
        } catch {
          promise.reject("ERR_SLEEP_SAMPLES", error.localizedDescription)
        }
      }
    }
  }

  private func epoch(ms: Double) -> Date {
    Date(timeIntervalSince1970: ms / 1000)
  }

  private func samplesPredicate(fromMs: Double, toMs: Double) -> NSPredicate {
    HKQuery.predicateForSamples(
      withStart: epoch(ms: fromMs),
      end: epoch(ms: toMs),
      options: .strictStartDate
    )
  }

  private func runSamples(_ query: HKSampleQuery) async throws -> [HKSample] {
    try await withCheckedThrowingContinuation { continuation in
      self.store.execute(query) { _, samples, error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: samples ?? [])
        }
      }
    }
  }

  private func runStatistics(_ query: HKStatisticsCollectionQuery) async throws -> HKStatisticsCollection {
    try await withCheckedThrowingContinuation { continuation in
      query.initialResultsHandler = { _, results, error in
        if let error {
          continuation.resume(throwing: error)
        } else if let results {
          continuation.resume(returning: results)
        } else {
          continuation.resume(throwing: NSError(
            domain: "AppleHealthModule",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Kueri Health tidak mengembalikan hasil."]
          ))
        }
      }
      self.store.execute(query)
    }
  }

  private func readWorkouts(fromMs: Double, toMs: Double) async throws -> [[String: Any?]] {
    let query = HKSampleQuery(
      sampleType: .workoutType(),
      predicate: samplesPredicate(fromMs: fromMs, toMs: toMs),
      limit: HKObjectQueryNoLimit,
      sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]
    )
    let samples = try await runSamples(query)
    let formatter = ISO8601DateFormatter()
    return samples.compactMap { sample -> [String: Any?]? in
      guard let workout = sample as? HKWorkout else { return nil }
      // doubleValue(for:) converts any stored energy/distance unit to ours.
      return [
        "id": workout.uuid.uuidString,
        "activityType": Int(workout.workoutActivityType.rawValue),
        "start": formatter.string(from: workout.startDate),
        "end": formatter.string(from: workout.endDate),
        "kcal": workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()) as Double?,
        "distanceMeters": workout.totalDistance?.doubleValue(for: .meter()) as Double?,
      ]
    }
  }

  private func readDailyTotals(fromMs: Double, toMs: Double) async throws -> [[String: Any?]] {
    let calendar = wibCalendar
    let anchor = calendar.startOfDay(for: epoch(ms: fromMs))
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = calendar.timeZone
    formatter.locale = Locale(identifier: "en_US_POSIX")

    let specs: [(type: HKQuantityType, unit: HKUnit, key: String)] = [
      (HKQuantityType(.stepCount), .count(), "steps"),
      (HKQuantityType(.distanceWalkingRunning), .meter(), "distanceMeters"),
      (HKQuantityType(.activeEnergyBurned), .kilocalorie(), "activeKcal"),
    ]

    var days: [String: [String: Any?]] = [:]
    for spec in specs {
      let query = HKStatisticsCollectionQuery(
        quantityType: spec.type,
        quantitySamplePredicate: nil,
        options: .cumulativeSum,
        anchorDate: anchor,
        intervalComponents: DateComponents(day: 1)
      )
      let results = try await runStatistics(query)
      results.enumerateStatistics(from: epoch(ms: fromMs), to: epoch(ms: toMs)) { statistics, _ in
        let day = formatter.string(from: statistics.startDate)
        var totals = days[day] ?? [
          "date": day,
          "steps": 0.0,
          "distanceMeters": 0.0,
          "activeKcal": 0.0,
        ]
        totals[spec.key] = statistics.sumQuantity()?.doubleValue(for: spec.unit) ?? 0.0
        days[day] = totals
      }
    }
    return days.values.sorted {
      ($0["date"] as? String ?? "") < ($1["date"] as? String ?? "")
    }
  }

  private func readSleepSamples(fromMs: Double, toMs: Double) async throws -> [[String: Any?]] {
    let query = HKSampleQuery(
      sampleType: HKCategoryType(.sleepAnalysis),
      predicate: samplesPredicate(fromMs: fromMs, toMs: toMs),
      limit: HKObjectQueryNoLimit,
      sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
    )
    let samples = try await runSamples(query)
    let formatter = ISO8601DateFormatter()
    return samples.compactMap { sample -> [String: Any?]? in
      guard let category = sample as? HKCategorySample else { return nil }
      return [
        "start": formatter.string(from: category.startDate),
        "end": formatter.string(from: category.endDate),
        "value": category.value,
      ]
    }
  }
}
