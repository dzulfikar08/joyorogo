/**
 * JoyoRogo local config plugin: bridgeless fix for react-native-android-widget.
 *
 * Under the New Architecture (Expo SDK 57 / RN 0.86, bridgeless) the library's
 * oss/HeadlessJsTaskWorker starts the headless JS task as soon as the React
 * context exists, but the JS bundle has not executed yet at that point, so
 * HeadlessJsTaskContext.startTask hits `hasActiveReactInstance() == false`,
 * logs "Cannot start headless task, CatalystInstance not available" and drops
 * the task. The launcher's WIDGET_ADDED / periodic WIDGET_UPDATE therefore
 * never reaches JS and the widget renders nothing.
 *
 * This plugin patches HeadlessJsTaskWorker.java to poll until the React host
 * finished initializing (`ReactHost.isInstanceInitialized`) before starting
 * the task, failing the worker after ~60s. Applied during every prebuild;
 * idempotent, and fails loudly if the upstream method drifts.
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "JoyoRogo bridgeless patch";

const TARGET_PATH = path.join(
  "node_modules",
  "react-native-android-widget",
  "android",
  "src",
  "main",
  "java",
  "com",
  "reactnativeandroidwidget",
  "oss",
  "HeadlessJsTaskWorker.java",
);

const ORIGINAL = `    private void invokeStartTask(ReactContext reactContext, final HeadlessJsTaskConfig taskConfig) {
        final HeadlessJsTaskContext headlessJsTaskContext = HeadlessJsTaskContext.getInstance(reactContext);
        headlessJsTaskContext.addTaskEventListener(this);
        UiThreadUtil.runOnUiThread(() -> this.taskId = headlessJsTaskContext.startTask(taskConfig));
    }`;

const PATCHED = `    private void invokeStartTask(ReactContext reactContext, final HeadlessJsTaskConfig taskConfig) {
        final HeadlessJsTaskContext headlessJsTaskContext = HeadlessJsTaskContext.getInstance(reactContext);
        headlessJsTaskContext.addTaskEventListener(this);
        startTaskWhenJsReady(reactContext, headlessJsTaskContext, taskConfig, 0);
    }

    // BEGIN ${MARKER}
    // Bridgeless (New Architecture): the React context is created before the
    // JS bundle executes, so starting the task immediately fails
    // "Cannot start headless task, CatalystInstance not available" and the
    // widget never renders. Poll until the host finished initializing.
    private static final int MAX_JS_READY_ATTEMPTS = 120;

    private void startTaskWhenJsReady(
        final ReactContext reactContext,
        final HeadlessJsTaskContext headlessJsTaskContext,
        final HeadlessJsTaskConfig taskConfig,
        final int attempt) {
        UiThreadUtil.runOnUiThread(
            new Runnable() {
                @Override
                public void run() {
                    if (reactContext.hasActiveReactInstance()) {
                        HeadlessJsTaskWorker.this.taskId = headlessJsTaskContext.startTask(taskConfig);
                    } else if (attempt < MAX_JS_READY_ATTEMPTS) {
                        new android.os.Handler(android.os.Looper.getMainLooper())
                            .postDelayed(
                                () ->
                                    startTaskWhenJsReady(
                                        reactContext,
                                        headlessJsTaskContext,
                                        taskConfig,
                                        attempt + 1),
                                500);
                    } else {
                        if (mCompleter != null) {
                            mCompleter.set(Result.failure());
                        }
                        cleanUpTask();
                    }
                }
            });
    }
    // END ${MARKER}`;

module.exports = function withWidgetHeadlessFix(config) {
  return withDangerousMod(config, [
    "android",
    (config) => {
      const file = path.join(config.modRequest.projectRoot, TARGET_PATH);
      let source = fs.readFileSync(file, "utf8");
      if (
        source.includes(MARKER) &&
        source.includes("reactContext.hasActiveReactInstance()")
      ) {
        // Already patched with the current version.
        return config;
      }
      // Drop any stale/older patch block and restore the pristine
      // invokeStartTask tail so the match below always applies.
      source = source.replace(
        /\/\/ BEGIN JoyoRogo bridgeless patch[\s\S]*?\/\/ END JoyoRogo bridgeless patch\r?\n?/g,
        "",
      );
      source = source.replace(
        /startTaskWhenJsReady\(reactContext, headlessJsTaskContext, taskConfig, 0\);/,
        "UiThreadUtil.runOnUiThread(() -> this.taskId = headlessJsTaskContext.startTask(taskConfig));",
      );
      // Upstream ships CRLF; match either line ending.
      const candidates = [
        [ORIGINAL, PATCHED],
        [
          ORIGINAL.replace(/\n/g, "\r\n"),
          PATCHED.replace(/\n/g, "\r\n"),
        ],
      ];
      const hit = candidates.find(([from]) => source.includes(from));
      if (!hit) {
        throw new Error(
          "with-widget-headless-fix: HeadlessJsTaskWorker.invokeStartTask did not match the expected source; react-native-android-widget changed upstream and the bridgeless widget fix must be updated.",
        );
      }
      fs.writeFileSync(file, source.replace(hit[0], hit[1]));
      return config;
    },
  ]);
};
