// Node exposes a `localStorage` global of its own — a getter that yields
// undefined unless node is started with --localstorage-file. Vitest's jsdom
// setup skips any key already present on the global, so jsdom's real
// implementation is never installed and `window.localStorage` reads as
// undefined in every DOM test that touches it. Re-point it at jsdom's Storage.
const dom = (globalThis as { jsdom?: { window?: Window } }).jsdom;
const storage = dom?.window?.localStorage;
if (storage) {
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: false,
  });
}
