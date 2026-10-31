"use strict";
// Compatibility wrapper: exposes the patched minimatch v11 implementation
// (CVE-2026-118764) with the minimatch v3 CommonJS API, for legacy transitive
// dependencies (glob@7 via swagger-autogen, eslint-plugin-react) that still
// `require("minimatch")` as a function and read v3 internals.
const mm = require("minimatch");

// minimatch v3 stored each non-literal path segment in `set` as a RegExp
// carrying the original glob in `_glob`; glob@7 relies on that shape
// (`segment._glob`, `entry.match(segment)`). v11 uses Matcher objects instead,
// so adapt them to a RegExp-like object backed by the v11 matcher.
function toV3Part(part) {
  if (typeof part === "string" || part === mm.GLOBSTAR) return part;
  if (!part || typeof part.test !== "function") return part;
  return {
    _glob: String(part.pattern),
    test: (s) => part.test(s),
    [Symbol.match]: (s) => (part.test(s) ? [s] : null),
    toString: () => String(part),
  };
}

class Minimatch extends mm.Minimatch {
  constructor(pattern, options) {
    super(pattern, options);
    if (Array.isArray(this.set)) {
      this.set = this.set.map((parts) => parts.map(toV3Part));
    }
  }
}

function minimatch(p, pattern, options) {
  return mm.minimatch(p, pattern, options);
}

Object.assign(minimatch, mm);
minimatch.Minimatch = Minimatch;
minimatch.minimatch = minimatch;
minimatch.default = minimatch;

module.exports = minimatch;
