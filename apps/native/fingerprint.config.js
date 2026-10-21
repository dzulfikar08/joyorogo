// Runtime fingerprint config (runtimeVersion policy "fingerprint").
//
// Only native inputs may move the runtime. The dev tool that runs `check-types` is not one, but
// `packageJson:scripts` hashes the script text, so swapping tsc for tsrs changed the runtime and
// orphaned every installed store build. Hash the type-check command as plain tsc so the fingerprint
// stays what it was; no installed binary changes with it.
/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  fileHookTransform: (source, chunk) => {
    if (source.type === 'contents' && source.id === 'packageJson:scripts') {
      return typeof chunk === 'string' ? chunk.replace(/\btsrs\b/g, 'tsc') : chunk;
    }
    return chunk;
  },
};
