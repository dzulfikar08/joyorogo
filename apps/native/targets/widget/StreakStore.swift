import Foundation

/// The App Group the app and this extension share. Must match IOS_APP_GROUP in apps/native/src/lib/widgets/ios-streak.ts
/// and ios.entitlements in app.json (a test checks both), and be enabled for both bundle ids in the Apple Developer portal
/// (docs/ios-widget.md).
let streakAppGroup = "group.com.joyodigitama.joyorogo"

/// What the app last wrote. Both keys are set by apps/native/src/lib/widgets/ios-streak-store.ts.
struct StreakStored {
    let snapshot: StreakSnapshot?
    /// "id", "en" or "ms": the app's own language, not the phone's, so the widget reads like the app.
    let language: String
}

enum StreakStore {
    static let snapshotKey = "streak"
    static let languageKey = "streak.lang"

    static func load(defaults: UserDefaults? = UserDefaults(suiteName: streakAppGroup)) -> StreakStored {
        let language = StreakCopy.resolve(defaults?.string(forKey: languageKey))
        guard let raw = defaults?.string(forKey: snapshotKey), let data = raw.data(using: .utf8),
              let snapshot = try? JSONDecoder().decode(StreakSnapshot.self, from: data) else {
            return StreakStored(snapshot: nil, language: language)
        }
        return StreakStored(snapshot: snapshot, language: language)
    }
}

/// The widget's copy: apps/native/targets/widget/streak-copy.json, generated from packages/i18n/src/locales/*/misc.json
/// (ios-streak.test.ts fails when it is out of date, `UPDATE_WIDGET_FILES=1 bun test` rewrites it). Keys are the same
/// 'misc:widget...' keys the Android widget uses.
enum StreakCopy {
    static let languages = ["id", "en", "ms"]

    private static let table: [String: [String: String]] = {
        guard let url = Bundle.main.url(forResource: "streak-copy", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let table = try? JSONDecoder().decode([String: [String: String]].self, from: data) else { return [:] }
        return table
    }()

    /// The app's language when it wrote one we ship, else the phone's first language we ship, else Indonesian.
    static func resolve(_ stored: String?, preferred: [String] = Locale.preferredLanguages) -> String {
        if let stored, languages.contains(stored) { return stored }
        for tag in preferred {
            let base = String(tag.split(separator: "-").first ?? "").lowercased()
            // "in" is the legacy code of Indonesian.
            let language = base == "in" ? "id" : base
            if languages.contains(language) { return language }
        }
        return "id"
    }

    static func text(_ key: String, language: String) -> String {
        table[language]?[key] ?? table["id"]?[key] ?? ""
    }
}
