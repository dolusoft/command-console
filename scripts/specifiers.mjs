// The bare module specifiers a source or built file names: static and
// dynamic imports, re-exports, `require()` and `import x = require()`.
// Relative specifiers are left out. Used by `scripts/check-deps.mjs`.
const pattern =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"./][^'"]*)['"]/g

/** Every bare specifier in `code`, in order, repeats included. */
export const specifiersOf = code =>
  [...code.matchAll(pattern)].map(([, specifier]) => specifier)
