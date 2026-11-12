// SPDX-License-Identifier: GPL-3.0-only
// Minimal shared stores. After a set() on any store the interface renders again from its root
// (boot.js, onChange()), and Preact only touches what changed: components read a store with
// get() and need no hook, so the light interface does without preact/hooks.
const listeners = new Set();
export const onChange = f => listeners.add(f);

export function createStore(initial) {
  let state = initial;
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      listeners.forEach(f => f());
    }
  };
}
