// Recursive merge used by PATCH. Plain objects merge, arrays and scalars replace,
// and null is stored as null. A value of {"__delete__": true} removes the key.
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const v = source[key];
    if (isPlain(v) && v.__delete__) {
      delete target[key];
    } else if (isPlain(v)) {
      if (!isPlain(target[key])) target[key] = {};
      deepMerge(target[key], v);
    } else {
      target[key] = Array.isArray(v) ? v.slice() : v;
    }
  }
  return target;
}
