import SwiftUI
import WidgetKit

// Streak Catat, the iPhone twin of apps/native/src/lib/widgets/streak-ui.tsx: a flame with the days in a row and Joyo
// reacting, one tap to the scan camera. The states and copy come from StreakModel.swift / streak-copy.json.

/// Must match the `kind` the app passes to ExtensionStorage.reloadWidget (IOS_WIDGET_KIND in ios-streak.ts).
let streakWidgetKind = "StreakCatat"

/// The 1x1 "Foto makanan" deep link of the Android widget: opens the scan camera (a signed-out person is sent to the
/// login and brought back to it). Same string as CAMERA_WIDGET_URI in names.ts.
let streakScanURL = URL(string: "joyorogo://makan-ai")!

/// Midnights ahead each timeline carries (and, between them, the mood hours). WidgetKit reloads at the end of the last one;
/// the app also reloads it every time it writes a new snapshot.
let streakTimelineDays = 7

// MARK: - Timeline

struct StreakEntry: TimelineEntry {
    let date: Date
    let snapshot: StreakSnapshot?
    let language: String

    var zone: String? { snapshot?.day?.zone }
    /// The day is the person's (their zone); the mood hour is the phone's own clock, like the Android widget's.
    var model: StreakModel { streakModel(snapshot, today: dayString(date, zone: zone), hour: localHour(date)) }
}

struct StreakProvider: TimelineProvider {
    /// Gallery and redacted placeholder: the lit state, so the picker shows the flame.
    private func sample(at date: Date = Date()) -> StreakEntry {
        let today = dayString(date, zone: nil)
        let day = StreakDay(zone: nil, streak: StreakStamp(days: 12, lastLoggedDate: today, previousLoggedDate: nil), maternal: false, gain: false)
        return StreakEntry(date: date, snapshot: StreakSnapshot(v: 1, signedIn: true, day: day),
                           language: StreakCopy.resolve(nil))
    }

    func placeholder(in context: Context) -> StreakEntry { sample() }

    func getSnapshot(in context: Context, completion: @escaping (StreakEntry) -> Void) {
        if context.isPreview { return completion(sample()) }
        let stored = StreakStore.load()
        completion(StreakEntry(date: Date(), snapshot: stored.snapshot, language: stored.language))
    }

    /// One entry now and one at each of the next midnights in the person's day zone and at each mood hour (12:00, 17:00,
    /// 21:00 on the phone's clock), so a lit flame turns "at risk" at midnight and "broken" a day later and Joyo gets more
    /// worried through the day, with no network and no app launch.
    func getTimeline(in context: Context, completion: @escaping (Timeline<StreakEntry>) -> Void) {
        let stored = StreakStore.load()
        let zone = stored.snapshot?.day?.zone
        let dates = timelineDates(from: Date(), zone: zone, days: streakTimelineDays)
        let entries = dates.map { StreakEntry(date: $0, snapshot: stored.snapshot, language: stored.language) }
        completion(Timeline(entries: entries, policy: .after(dates.last ?? Date().addingTimeInterval(86_400))))
    }
}

// MARK: - Look

/// Same tokens as apps/native/theme.ts (lightTheme / darkTheme); update both together.
private struct Palette {
    let card, foreground, muted, mutedForeground, bakar, bakarSoft, bakarText, eatNear: Color

    static let light = Palette(
        card: Color(hex: 0xFFFFFF), foreground: Color(hex: 0x1D1A15), muted: Color(hex: 0xF0ECE5),
        mutedForeground: Color(hex: 0x66635C), bakar: Color(hex: 0xDE602F), bakarSoft: Color(hex: 0xFFE8E0),
        bakarText: Color(hex: 0x953B17), eatNear: Color(hex: 0xE5A50A))
    static let dark = Palette(
        card: Color(hex: 0x1E1B17), foreground: Color(hex: 0xF1EEE9), muted: Color(hex: 0x2C2922),
        mutedForeground: Color(hex: 0x9C9890), bakar: Color(hex: 0xF18761), bakarSoft: Color(hex: 0x43251A),
        bakarText: Color(hex: 0xF18761), eatNear: Color(hex: 0xE5A50A))
}

private extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: 1)
    }
}

/// Plus Jakarta Sans, bundled as UIAppFonts (Info.plist). A font that failed to register falls back to the system font.
private enum Face {
    static func bold(_ size: CGFloat) -> Font { .custom("PlusJakartaSans-Bold", size: size, relativeTo: .caption2) }
    static func heavy(_ size: CGFloat) -> Font { .custom("PlusJakartaSans-ExtraBold", fixedSize: size) }
}

/// The Android flame (24x24 viewBox): an outline and an inner tongue. The arcs of the SVG are cubic curves here.
private struct Flame: Shape {
    enum Part { case outer, inner }
    let part: Part

    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        let dx = rect.minX + (rect.width - 24 * s) / 2
        let dy = rect.minY + (rect.height - 24 * s) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: dx + x * s, y: dy + y * s) }
        var path = Path()
        switch part {
        case .outer:
            path.move(to: p(12, 2.2))
            path.addCurve(to: p(15.9, 9.4), control1: p(12.4, 5.6), control2: p(14.1, 7.3))
            path.addCurve(to: p(19, 15.8), control1: p(17.7, 11.5), control2: p(19, 13.4))
            // A7 7 0 0 1 5 15.8: the bottom half circle around (12, 15.8)
            path.addCurve(to: p(12, 22.8), control1: p(19, 19.666), control2: p(15.866, 22.8))
            path.addCurve(to: p(5, 15.8), control1: p(8.134, 22.8), control2: p(5, 19.666))
            path.addCurve(to: p(7.6, 9.9), control1: p(5, 13), control2: p(6.3, 11.3))
            path.addCurve(to: p(10.4, 11.8), control1: p(8.6, 11.2), control2: p(9.4, 11.8))
            path.addCurve(to: p(12, 2.2), control1: p(10.4, 8.2), control2: p(10.7, 5))
        case .inner:
            path.move(to: p(12, 21.5))
            // A3.9 3.9 0 0 1 8.1 17.6: the lower left quarter circle around (12, 17.6)
            path.addCurve(to: p(8.1, 17.6), control1: p(9.846, 21.5), control2: p(8.1, 19.754))
            path.addCurve(to: p(10.6, 12.8), control1: p(8.1, 15.5), control2: p(9.5, 14.4))
            path.addCurve(to: p(12.7, 15.4), control1: p(11.1, 14.1), control2: p(11.8, 14.5))
            path.addCurve(to: p(15.9, 17.6), control1: p(13.7, 16.4), control2: p(15.9, 16.6))
            path.addCurve(to: p(12, 21.5), control1: p(15.9, 19.754), control2: p(14.154, 21.5))
        }
        path.closeSubpath()
        return path
    }
}

private struct FlameMark: View {
    let lit: Bool
    let palette: Palette

    var body: some View {
        ZStack {
            Flame(part: .outer).fill(lit ? palette.bakar : palette.mutedForeground)
            Flame(part: .inner).fill(lit ? palette.eatNear : palette.muted)
        }
        .widgetAccentable()
    }
}

// MARK: - Views

private struct StreakView: View {
    let entry: StreakEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme

    private var palette: Palette { scheme == .dark ? .dark : .light }
    private var model: StreakModel { entry.model }

    private func copy(_ key: String) -> String { StreakCopy.text(key, language: entry.language) }

    private var surface: Color {
        switch model.kind {
        case .done, .atRisk: return palette.bakarSoft
        case .broken: return palette.muted
        default: return palette.card
        }
    }

    /// Tapping anything but signed out / no plan opens the scan camera; those two just open the app.
    private var tapURL: URL? {
        switch model.kind {
        case .signedOut, .noTarget: return nil
        default: return streakScanURL
        }
    }

    private var title: String { model.titleKey.map(copy) ?? "" }
    private var label: String { model.labelKey.map(copy) ?? "" }
    private var line: String { copy(model.lineKey) }
    /// "hari beruntun" is the flame and number's own meaning; only the broken count needs its unit spelled out.
    private var showsLabel: Bool { model.kind == .broken }

    private var spoken: String {
        [model.count.map(String.init) ?? title, label, line].filter { !$0.isEmpty }.joined(separator: ". ")
    }

    private var numberSize: CGFloat {
        let digits = model.count.map { String($0).count } ?? 0
        return digits >= 4 ? 30 : digits == 3 ? 34 : 38
    }

    private var mascot: some View {
        Image("mascot-\(model.pose.rawValue)")
            .resizable()
            .interpolation(.high)
            .widgetAccentedFullColor()
            .scaledToFit()
            .accessibilityHidden(true)
    }

    /// The number with its flame, or the title that stands in for it (fresh, signed out, no plan, off).
    @ViewBuilder
    private func headline(alignment: TextAlignment) -> some View {
        if let count = model.count {
            HStack(spacing: 4) {
                FlameMark(lit: model.lit, palette: palette)
                    .frame(width: numberSize * 0.8, height: numberSize * 0.8)
                Text(String(count))
                    .font(Face.heavy(numberSize))
                    .foregroundStyle(model.lit ? palette.bakarText : palette.foreground)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .widgetAccentable()
            }
        } else {
            Text(title)
                .font(Face.heavy(20))
                .foregroundStyle(palette.foreground)
                .multilineTextAlignment(alignment)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
        }
    }

    private func captions(size: CGFloat, lines: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if showsLabel {
                Text(label)
                    .font(Face.bold(size))
                    .foregroundStyle(palette.mutedForeground)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
            Text(line)
                .font(Face.bold(size))
                .foregroundStyle(palette.foreground)
                .lineLimit(lines)
                .minimumScaleFactor(0.75)
        }
    }

    private var small: some View {
        GeometryReader { geo in
            let slot = min(110, geo.size.width * 0.44)
            VStack(spacing: 6) {
                headline(alignment: .center)
                    .frame(maxWidth: .infinity, minHeight: model.count == nil ? 44 : nil, alignment: .center)
                HStack(spacing: 6) {
                    mascot
                        .frame(width: slot, alignment: .leading)
                        .frame(maxHeight: 100)
                    captions(size: 11, lines: showsLabel ? 3 : 4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: .infinity)
            }
        }
    }

    private var medium: some View {
        HStack(spacing: 12) {
            mascot
                .frame(maxWidth: 130, maxHeight: .infinity)
            VStack(alignment: .leading, spacing: 6) {
                headline(alignment: .leading)
                captions(size: 14, lines: 3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    var body: some View {
        Group {
            switch family {
            case .systemMedium: medium
            default: small
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .widgetURL(tapURL)
        .padding(12)
        .streakContainerBackground(surface)
    }
}

private extension View {
    /// iOS 17 wants the widget background in `containerBackground`; 16.x draws it behind the content.
    @ViewBuilder
    func streakContainerBackground(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(color, for: .widget)
        } else {
            self.background(color)
        }
    }

}

private extension Image {
    /// The tinted home screen of iOS 18 would flatten Joyo into one colour; keep his own.
    @ViewBuilder
    func widgetAccentedFullColor() -> some View {
        if #available(iOS 18.0, *) {
            self.widgetAccentedRenderingMode(.fullColor)
        } else {
            self
        }
    }
}

// MARK: - Widget

struct StreakCatatWidget: Widget {
    var body: some WidgetConfiguration {
        // The gallery strings follow the app's language like the tile itself.
        let language = StreakStore.load().language
        return StaticConfiguration(kind: streakWidgetKind, provider: StreakProvider()) { entry in
            StreakView(entry: entry)
        }
        .configurationDisplayName(StreakCopy.text("misc:widget.streak.title", language: language))
        .description(StreakCopy.text("misc:widget.streak.gallery", language: language))
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabledIfAvailable()
    }
}

private extension WidgetConfiguration {
    /// iOS 17 adds default content margins on top of the padding the layout already draws; the tile owns its padding.
    func contentMarginsDisabledIfAvailable() -> some WidgetConfiguration {
        if #available(iOS 17.0, *) {
            return self.contentMarginsDisabled()
        }
        return self
    }
}
