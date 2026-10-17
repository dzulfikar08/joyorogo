/**
 * Every string the analysis components show. The host passes a translator `t`; `makeEnglishT` is the English one.
 * Placeholders are `{name}`; plurals are separate keys.
 */

export const englishText = {
  // Section titles
  'section.charts': 'Charts',
  'section.splits': 'Splits',
  'section.hrZones': 'Heart rate zones',
  'section.paceZones': 'Pace zones',
  'section.bestEfforts': 'Best efforts',
  'section.effort': 'Relative effort',
  'section.load': 'Training load',
  'section.laps': 'Laps',
  'section.comparison': 'Compared with similar workouts',
  'section.route': 'Route',
  'section.heartRate': 'Heart rate',

  // Units
  'unit.km': 'km',
  'unit.m': 'm',
  'unit.kmh': 'km/h',
  'unit.perKm': '/km',
  'unit.bpm': 'bpm',
  'unit.spm': 'spm',
  'unit.rpm': 'rpm',
  'unit.w': 'W',
  'unit.kcal': 'kcal',
  'unit.kcalPerHour': 'kcal/h',
  'unit.hours': 'h',
  'unit.g': 'g',
  'unit.time': 'time',

  // Summary
  'summary.distance': 'Distance',
  'summary.time': 'Time',
  'summary.movingTime': 'Moving time',
  'summary.elapsed': 'Elapsed {time}',
  'summary.avgPace': 'Avg pace',
  'summary.avgSpeed': 'Avg speed',
  'summary.elevation': 'Elevation',
  'summary.calories': 'Calories',
  'summary.heartRate': 'Heart rate',
  'summary.maxHr': 'max {value} bpm',
  'summary.cadence': 'Cadence',
  'summary.maxCadence': 'max {value}',
  'summary.power': 'Avg power',
  'summary.normalizedPower': 'NP {value} W',
  'summary.fuel': 'Estimated fuel',
  'summary.fat': 'fat {value} g',
  'summary.carbs': 'carbs {value} g',
  'summary.a11y': 'Workout summary',

  // Metrics and chart
  'metric.pace': 'Pace',
  'metric.speed': 'Speed',
  'metric.hr': 'Heart rate',
  'metric.elevation': 'Elevation',
  'metric.cadence': 'Cadence',
  'metric.power': 'Power',
  'chart.hint': 'Touch and drag the chart to inspect the workout',
  'chart.clear': 'Clear marker',
  'chart.a11y': '{metric} chart. Swipe up or down to move the marker.',
  'chart.noData': 'Not enough data for this chart.',

  // Splits
  'splits.km': 'Km',
  'splits.pace': 'Pace',
  'splits.speed': 'Speed',
  'splits.elev': 'Elev',
  'splits.hr': 'HR',
  'splits.cad': 'Cad',
  'splits.a11yRowPace': 'Split {label}, {value} per kilometre',
  'splits.a11yRowSpeed': 'Split {label}, {value} kilometres per hour',
  'splits.a11yHint': 'Moves the marker on the charts and the map',

  // Zones
  'zone.recovery': 'Recovery',
  'zone.endurance': 'Endurance',
  'zone.tempo': 'Tempo',
  'zone.threshold': 'Threshold',
  'zone.vo2': 'Anaerobic / VO2 max',
  'zones.maxHrAge': 'Max HR {value} bpm (from your age)',
  'zones.maxHrSetting': 'Max HR {value} bpm (your setting)',
  'zones.hrNote': 'Zones 1 to 5 are 50-60, 60-70, 70-80, 80-90 and 90-100 percent of your max heart rate. Percentages are shares of the time spent in a zone.',
  'zones.below': 'Below zone 1: {time}',
  'zones.thresholdPace': 'Threshold pace {pace} /km',
  'zones.slowerThan': 'slower than {pace}',
  'zones.fasterThan': 'faster than {pace}',
  'zones.zoneLabel': 'Z{n} {name}',
  'zones.a11yRow': 'Zone {n}, {name}, {range}, {time}, {percent} percent',

  // Best efforts
  'best.400m': '400 m',
  'best.1k': '1 km',
  'best.1mi': '1 mile',
  'best.5k': '5 km',
  'best.10k': '10 km',
  'best.half': 'Half marathon',
  'best.pr': 'PR',
  'best.2nd': '2nd',
  'best.3rd': '3rd',
  'best.note': 'Fastest stretch of each distance in this workout. Ranked against your similar workouts of the last 120 days.',
  'best.a11yRow': '{label}, {time}, {pace} per kilometre',
  'best.a11yRank': 'rank {rank}',

  // Effort
  'effort.band.light': 'Light',
  'effort.band.moderate': 'Moderate',
  'effort.band.hard': 'Hard',
  'effort.band.max': 'All out',
  'effort.outOf': 'of 21',
  'effort.addedToDay': '+{value} to the day',
  'effort.explain': 'Relative Effort is JoyoFit\'s strain for this workout on a 0 to 21 scale: the longer your heart works at a high level, the higher it goes (TRIMP {trimp}).',
  'effort.a11y': 'Relative effort {value} of 21, {band}',

  // Load
  'load.thisWorkout': 'This workout',
  'load.trimp': 'TRIMP',
  'load.last7': 'Last 7 days',
  'load.weeklyAverage': 'Weekly average',
  'load.verdict.under': 'Under',
  'load.verdict.steady': 'Steady',
  'load.verdict.high': 'High',
  'load.verdict.spike': 'Spike',
  'load.verdictText.under': 'Lighter than your usual week.',
  'load.verdictText.steady': 'In line with your usual week.',
  'load.verdictText.high': 'Heavier than your usual week.',
  'load.verdictText.spike': 'A big jump on your usual week. Plan some easy days.',
  'load.ratio': '{percent}% of your weekly average',
  'load.aerobic': 'Aerobic effect',
  'load.anaerobic': 'Anaerobic effect',
  'load.recovery': 'Recovery',
  'load.recoveryHours': '{value} h',
  'load.watchLoad': 'Watch load',
  'load.a11y': 'Training load {verdict}',

  // Laps
  'laps.lap': 'Lap',
  'laps.time': 'Time',
  'laps.dist': 'Dist',
  'laps.pace': 'Pace',
  'laps.speed': 'Speed',
  'laps.hr': 'HR',
  'laps.cad': 'Cad',

  // Comparison
  'compare.thisWorkout': 'This workout',
  'compare.previous': 'Previous',
  'compare.average': 'Average of {n}',
  'compare.vsPrevious': 'vs previous',
  'compare.vsAverage': 'vs average',
  'compare.dist': 'Dist',
  'compare.time': 'Time',
  'compare.pace': 'Pace',
  'compare.speed': 'Speed',
  'compare.hr': 'Avg HR',
  'compare.basisDistance': 'Compared with your last {n} workouts of similar distance (within 20%).',
  'compare.basisDistanceOne': 'Compared with your last workout of similar distance (within 20%).',
  'compare.basisDuration': 'Compared with your last {n} workouts of similar duration (within 25%).',
  'compare.basisDurationOne': 'Compared with your last workout of similar duration (within 25%).',

  // Notes: how the numbers are calculated
  'note.effort': 'Each minute of heart rate counts by the zone it falls in (Edwards TRIMP) and the total is mapped onto the 0 to 21 scale. It relies on your max heart rate, so set it in your profile for best results.',
  'note.load': 'Load is the Edwards TRIMP: minutes in each heart rate zone multiplied by the zone number. The last 7 days add up to this workout; the weekly average is the mean of the 28 days before it.',
  'note.threshold': 'Threshold pace is estimated from your best 1 mile, 5 km, 10 km and half marathon efforts, slowed to a one hour effort. Zones are set as shares of it.',

  // Empty states and basic view
  'empty.noSeries': 'Charts, map and splits are not available for this workout because no detailed samples were recorded.',
  'basic.noData': 'No heart rate or route was shared with this workout.',
  'basic.hrChart': 'Heart rate chart',
  'basic.hrRange': '{min} to {max} bpm',
  'basic.routeA11y': 'Route map of the workout',
} as const;

export type AnalysisTextKey = keyof typeof englishText;

export type AnalysisT = (key: AnalysisTextKey, vars?: Record<string, string | number>) => string;

export function makeEnglishT(): AnalysisT {
  return (key, vars) => {
    const template: string = englishText[key];
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const value = vars[name];
      return value === undefined ? whole : String(value);
    });
  };
}
