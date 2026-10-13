// Named domain contracts for API rows that ship inferred-only (packages/api is
// frozen for the web team). Derived once at the AppRouterClient boundary so
// consumers import stable names instead of implementation helpers.
import type { AppRouterClient } from "@joyorogo/api/routers/index";

type FoodListOutput = Awaited<ReturnType<AppRouterClient["food"]["listByDate"]>>;

/** One food_log row as returned by food.listByDate / food.add. */
export type FoodItem = FoodListOutput["items"][number];

/** Input contract of food.add (meal, macros optional, source/itemsJson for AI). */
export type FoodAddInput = Parameters<AppRouterClient["food"]["add"]>[0];

type FoodRecentOutput = Awaited<ReturnType<AppRouterClient["food"]["recent"]>>;

/** One quick-add entry of food.recent ({ name, kcal, meal, lastDate }). */
export type FoodRecentItem = FoodRecentOutput["items"][number];

type ExerciseListOutput = Awaited<ReturnType<AppRouterClient["exercise"]["listByDate"]>>;

/** One exercise_log row as returned by exercise.listByDate / exercise.add. */
export type ExerciseItem = ExerciseListOutput["items"][number];

type ExerciseTypesOutput = Awaited<ReturnType<AppRouterClient["exercise"]["types"]>>;

/** One entry of the activity-type catalog ({ key, label, met }). */
export type ExerciseType = ExerciseTypesOutput[number];

type AiAnalyzeOutput = Awaited<ReturnType<AppRouterClient["ai"]["analyzeFood"]>>;

/** One dish recognized by the vision AI. */
export type AiFoodItem = AiAnalyzeOutput["items"][number];

type AiDescribeOutput = Awaited<ReturnType<AppRouterClient["ai"]["describeFood"]>>;

/** One item from a typed/spoken story, already placed on a meal slot and date. */
export type StoryFoodItem = AiDescribeOutput["items"][number];

type ProfileOutput = Awaited<ReturnType<AppRouterClient["profile"]["myProfile"]>>;

/** The user's profile row, or null before onboarding. */
export type ProfileRow = NonNullable<ProfileOutput["profile"]>;

type DaySummaryOutput = Awaited<ReturnType<AppRouterClient["day"]["summary"]>>;

/** day.summary for a user who finished onboarding (the branch carrying targets + deficit). */
export type DaySummary = Extract<DaySummaryOutput, { deficit: unknown }>;

type WeightHistoryOutput = Awaited<ReturnType<AppRouterClient["weight"]["history"]>>;

/** weight.history output: raw scale entries oldest-first + rollup summary. */
export type WeightHistory = WeightHistoryOutput;

/** One weight_log row as returned by weight.history / weight.checkIn. */
export type WeightEntry = WeightHistoryOutput["entries"][number];

type SleepGetOutput = Awaited<ReturnType<AppRouterClient["sleep"]["getForDate"]>>;

/** One sleep_log row as returned by sleep.getForDate, or null before logging. */
export type SleepLog = SleepGetOutput;

type WorkoutCatalogOutput = Awaited<ReturnType<AppRouterClient["workout"]["catalog"]>>;

/** workout.catalog: movement catalog plus muscle/equipment label lists. */
export type WorkoutCatalog = WorkoutCatalogOutput;

/** One catalog movement ({ id, name, equipment, primary, secondary }). */
export type CatalogExercise = WorkoutCatalogOutput["exercises"][number];

type WorkoutListOutput = Awaited<ReturnType<AppRouterClient["workout"]["listSessions"]>>;

/** One session with its sets, as returned by workout.listSessions/getSession/saveSession. */
export type WorkoutSessionItem = WorkoutListOutput["items"][number];

type WorkoutStatusOutput = Awaited<ReturnType<AppRouterClient["workout"]["status"]>>;

/** workout.status: weekly muscle volume, warnings, PRs, strength-trend hint. */
export type WorkoutStatus = WorkoutStatusOutput;

type GroupListOutput = Awaited<ReturnType<AppRouterClient["group"]["list"]>>;

/** One row of group.list ({ id, name, role, memberCount, inviteCode }). */
export type GroupSummary = GroupListOutput[number];

type GroupDetailOutput = Awaited<ReturnType<AppRouterClient["group"]["detail"]>>;

/** group.detail output: the group card plus every member's day. */
export type GroupDetail = GroupDetailOutput;

/** One member card of group.detail, with today's numbers and streak. */
export type GroupMember = GroupDetailOutput["members"][number];

type GroupActivityOutput = Awaited<ReturnType<AppRouterClient["group"]["activity"]>>;

/** One feed event of group.activity (food | exercise | weight). */
export type GroupActivityEvent = GroupActivityOutput[number];

type InboxOutput = Awaited<ReturnType<AppRouterClient["group"]["inbox"]>>;

/** One nudge received in group.inbox. */
export type InboxItem = InboxOutput[number];

type VarScanOutput = Awaited<ReturnType<AppRouterClient["group"]["varScan"]>>;

/** varScan output: verdict, totals, and the member's shared foods. */
export type VarScan = VarScanOutput;

type SocialProfileOutput = Awaited<ReturnType<AppRouterClient["social"]["myProfile"]>>;
type FeedOutput = Awaited<ReturnType<AppRouterClient["social"]["feed"]>>;
type PublicProfileOutput = Awaited<ReturnType<AppRouterClient["social"]["publicProfile"]>>;
type SocialNotificationsOutput = Awaited<
  ReturnType<AppRouterClient["social"]["notifications"]>
>;
type SocialCommentsOutput = Awaited<ReturnType<AppRouterClient["social"]["comments"]>>;

/** Feed identity + counters of the signed-in user. */
export type SocialProfile = SocialProfileOutput;

/** One post card in the feed. */
export type FeedPost = FeedOutput["items"][number];
export type SocialNotificationItem = SocialNotificationsOutput["items"][number];
export type PostCommentItem = SocialCommentsOutput["items"][number];
export type PublicProfileData = PublicProfileOutput;
