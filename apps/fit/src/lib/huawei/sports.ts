// Port of `WorkoutSportTypes.kt` (Gadgetbridge's sport table: the watch's sport id to ActivityKind and its English name) and of
// `HuaweiExportSports` (`HuaweiMotionPathParser.kt`: a Huawei export's sport id to the watch's).

const TABLE = new Map<number, [kind: string, name: string]>([
  [1, ["RUNNING", "Running"]],
  [2, ["WALKING", "Walking"]],
  [3, ["CYCLING", "Biking"]],
  [4, ["MOUNTAIN_HIKE", "Mountain Hike"]],
  [5, ["INDOOR_RUNNING", "Indoor Running"]],
  [6, ["POOL_SWIM", "Pool Swimming"]],
  [7, ["INDOOR_CYCLING", "Indoor Cycling"]],
  [8, ["SWIMMING_OPENWATER", "Swimming (Open water)"]],
  [11, ["TRAIL_RUN", "Trail run"]],
  [13, ["INDOOR_WALKING", "Indoor Walking"]],
  [14, ["HIKING", "Hiking"]],
  [21, ["JUMP_ROPING", "Jumping Rope"]],
  [22, ["FREE_DIVING", "Free Diving"]],
  [23, ["APNEA_TRAINING", "Apnea Training"]],
  [24, ["APNEA_TEST", "Apnea Test"]],
  [25, ["SCUBA_DIVING", "SCUBA Diving"]],
  [128, ["PINGPONG", "Ping Pong"]],
  [129, ["BADMINTON", "Badminton"]],
  [130, ["TENNIS", "Tennis"]],
  [131, ["SOCCER", "Soccer"]],
  [132, ["BASKETBALL", "Basketball"]],
  [133, ["VOLLEYBALL", "Volleyball"]],
  [134, ["ELLIPTICAL_TRAINER", "Elliptical Trainer"]],
  [135, ["ROWING_MACHINE", "Rowing Machine"]],
  [136, ["STEPPER", "Stepper"]],
  [137, ["YOGA", "Yoga"]],
  [138, ["PILATES", "Pilates"]],
  [139, ["AEROBICS", "Aerobics"]],
  [140, ["STRENGTH_TRAINING", "Strength Training"]],
  [141, ["SPINNING", "Spinning"]],
  [142, ["AIR_WALKER", "Air walker"]],
  [143, ["HIIT", "High-intensity Interval Training"]],
  [145, ["CROSSFIT", "Crossfit"]],
  [146, ["FUNCTIONAL_TRAINING", "Functional training"]],
  [147, ["PHYSICAL_TRAINING", "Physical training"]],
  [148, ["TAEKWONDO", "Taekwondo"]],
  [149, ["BOXING", "Boxing"]],
  [150, ["FREE_SPARRING", "Free sparring"]],
  [151, ["KARATE", "Karate"]],
  [152, ["FENCING", "Fencing"]],
  [153, ["BELLY_DANCE", "Belly dance"]],
  [154, ["JAZZ_DANCE", "Jazz dance"]],
  [155, ["LATIN_DANCE", "Latin dance"]],
  [156, ["BALLET", "Ballet"]],
  [157, ["CORE_TRAINING", "Core Training"]],
  [158, ["BODY_COMBAT", "Body combat"]],
  [159, ["KENDO", "Kendo"]],
  [160, ["HORIZONTAL_BAR", "Horizontal bar"]],
  [161, ["PARALLEL_BARS", "Parallel bars"]],
  [162, ["STREET_DANCE", "Street Dance"]],
  [163, ["ROLLER_SKATING", "Roller skating"]],
  [164, ["MARTIAL_ARTS", "Martial arts"]],
  [165, ["PLAZA_DANCING", "Plaza dancing"]],
  [166, ["TAI_CHI", "Tai chi"]],
  [167, ["DANCE", "Dance"]],
  [168, ["HULA_HOOP", "Hula hoop"]],
  [169, ["FRISBEE", "Frisbee"]],
  [170, ["DARTS", "Darts"]],
  [171, ["ARCHERY", "Archery"]],
  [172, ["HORSE_RIDING", "Horse riding"]],
  [173, ["LASER_TAG", "Laser tag"]],
  [174, ["KITE_FLYING", "Kite Flying"]],
  [175, ["TUG_OF_WAR", "Tug of war"]],
  [176, ["SWING", "Swing"]],
  [177, ["STAIRS", "Stairs"]],
  [178, ["OBSTACLE_RACE", "Obstacle race"]],
  [179, ["BILLIARD_POOL", "Pool"]],
  [180, ["BOWLING", "Bowling"]],
  [181, ["SHUTTLECOCK", "Shuttlecock"]],
  [182, ["HANDBALL", "Handball"]],
  [183, ["BASEBALL", "Baseball"]],
  [184, ["SOFTBALL", "Softball"]],
  [185, ["CRICKET", "Cricket"]],
  [186, ["RUGBY", "Rugby"]],
  [187, ["BEACH_SOCCER", "Beach Soccer"]],
  [188, ["BEACH_VOLLEYBALL", "Beach Volleyball"]],
  [189, ["GATEBALL", "Gateball"]],
  [190, ["HOCKEY", "Hockey"]],
  [191, ["SQUASH", "Squash"]],
  [192, ["SEPAK_TAKRAW", "Sepak Takraw"]],
  [193, ["DODGEBALL", "Dodgeball"]],
  [194, ["SAILING", "Sailing"]],
  [195, ["SURFING", "Surfing"]],
  [196, ["FISHING", "Fishing"]],
  [197, ["RAFTING", "Rafting"]],
  [198, ["DRAGON_BOAT", "Dragon boat"]],
  [199, ["CANOEING", "Canoeing"]],
  [200, ["ROWING", "Rowing"]],
  [201, ["WATER_SCOOTER", "Water scooter"]],
  [202, ["STAND_UP_PADDLEBOARDING", "Standup Paddleboarding"]],
  [203, ["ICE_SKATING", "Ice Skating"]],
  [204, ["ICE_HOCKEY", "Ice hockey"]],
  [205, ["CURLING", "Curling"]],
  [206, ["BOBSLEIGH", "Bobsleigh"]],
  [207, ["SLEDDING", "Sledding"]],
  [208, ["BIATHLON", "Biathlon"]],
  [209, ["SKATEBOARDING", "Skateboarding"]],
  [210, ["ROCK_CLIMBING", "Rock climbing"]],
  [211, ["BUNGEE_JUMPING", "Bungee jumping"]],
  [212, ["PARKOUR", "Parkour"]],
  [213, ["BMX", "BMX"]],
  [214, ["ORIENTEERING", "Orienteering"]],
  [215, ["PARACHUTING", "Parachuting"]],
  [216, ["AUTO_RACING", "Auto racing"]],
  [223, ["ESPORTS", "Esports"]],
  [224, ["PADEL", "Padel"]],
  [255, ["EXERCISE", "Exercise"]],
]);

export const UNKNOWN_KIND = "UNKNOWN";

/** `WorkoutSportTypes.sport(type)`: the entry of the low byte of `type`. */
function sport(type: number): [string, string] | undefined {
  return TABLE.get(type & 0xff);
}

export function hasSport(type: number): boolean {
  return sport(type) !== undefined;
}

export function sportName(type: number): string {
  return sport(type)?.[1] ?? `Workout (type ${type & 0xff})`;
}

/** GB `ActivityKind` constant name, `UNKNOWN` for types GB does not know. */
export function sportKind(type: number): string {
  return sport(type)?.[0] ?? UNKNOWN_KIND;
}

/** GB `ActivityKind.isPaceActivity`: pace (time per distance) rather than speed is the natural figure. */
export function isPace(kind: string): boolean {
  return (
    kind.includes("RUN") ||
    kind.includes("SWIM") ||
    kind.includes("TREADMILL") ||
    kind.includes("WALK")
  );
}

/** The sport id for ones the export has but this table does not know: GB's catch-all `EXERCISE`. */
export const OTHER = 255;

const SPECIAL = new Map<number, number>([
  [1, 177], // climbing stairs
  [2, 4], // mountain climbing
  [3, 3], // outdoor cycling
  [4, 1], // outdoor running
  [5, 2], // outdoor walking
  [9, 8], // swimming
  [101, 5], // indoor running
  [102, 6], // pool swimming
  [103, 7], // indoor cycling
  [104, 8], // open water
  [105, 128],
  [106, 129],
  [107, 130],
  [108, 131],
  [109, 132],
  [110, 133], // racket and ball sports
  [111, 134],
  [112, 135],
  [113, 136], // elliptical, rowing machine, stepmill
  [114, 137],
  [115, 138],
  [116, 139], // yoga, pilates, aerobics
  [117, 140], // free weights: strength training
  [118, 11], // trail run
  [281, 13], // indoor walking
  [282, 14], // hiking
  [287, 22],
  [288, 23],
  [289, 24],
  [291, 25], // free diving, breath-hold training and test, scuba
]);

/** `HuaweiExportSports.joyofitType`. */
export function joyofitType(huaweiType: number | null): number {
  if (huaweiType === null) return OTHER;
  const special = SPECIAL.get(huaweiType);
  if (special !== undefined) return special;
  return ((huaweiType >= 140 && huaweiType <= 216) || huaweiType === 223) && hasSport(huaweiType)
    ? huaweiType
    : OTHER;
}

/** `HuaweiExportSports.name`. */
export function exportSportName(huaweiType: number | null): string {
  const type = joyofitType(huaweiType);
  return type !== OTHER ? sportName(type) : `Workout (Huawei type ${huaweiType ?? "unknown"})`;
}
