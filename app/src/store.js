// SPDX-License-Identifier: GPL-3.0-only
// Minimal shared store: a component that calls store.use() renders again after each set().
import { useState, useEffect } from 'preact/hooks';

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      subs.forEach(f => f());
    },
    use() {
      const [, bump] = useState(0);
      useEffect(() => {
        const f = () => bump(n => n + 1);
        subs.add(f);
        return () => subs.delete(f);
      }, []);
      return state;
    }
  };
}
