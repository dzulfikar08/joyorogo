// Hermes also has no Intl.PluralRules, which i18next uses to pick plural
// suffixes: without it, "result.save.items" with count 1 resolved to the raw
// key. The package installs itself only when Intl.PluralRules is missing.
import "intl-pluralrules";

// ES2023 array methods and Promise.withResolvers for Hermes. The shared
// packages/api/src/lib code (ideas.ts, plates.ts, places.ts, recap.ts) uses
// toSorted/findLast; Hermes lacks them, so calls crashed with "undefined is
// not a function" (the snack advice swap on a camilan scan). Loaded first in
// index.js, before any module that might call them.

const define = (target, name, value) => {
  if (typeof target[name] === "function") return;
  Object.defineProperty(target, name, { value, writable: true, configurable: true });
};

define(Array.prototype, "toSorted", function toSorted(compare) {
  return Array.prototype.slice.call(this).sort(compare);
});
define(Array.prototype, "toReversed", function toReversed() {
  return Array.prototype.slice.call(this).reverse();
});
define(Array.prototype, "toSpliced", function toSpliced(...args) {
  const copy = Array.prototype.slice.call(this);
  copy.splice(...args);
  return copy;
});
define(Array.prototype, "with", function withAt(index, value) {
  const copy = Array.prototype.slice.call(this);
  const i = index < 0 ? copy.length + index : index;
  if (i < 0 || i >= copy.length) throw new RangeError("Invalid index");
  copy[i] = value;
  return copy;
});
define(Array.prototype, "findLast", function findLast(predicate, thisArg) {
  for (let i = this.length - 1; i >= 0; i--) {
    if (predicate.call(thisArg, this[i], i, this)) return this[i];
  }
  return undefined;
});
define(Array.prototype, "findLastIndex", function findLastIndex(predicate, thisArg) {
  for (let i = this.length - 1; i >= 0; i--) {
    if (predicate.call(thisArg, this[i], i, this)) return i;
  }
  return -1;
});
define(Promise, "withResolvers", function withResolvers() {
  let resolve;
  let reject;
  const promise = new this((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
});
