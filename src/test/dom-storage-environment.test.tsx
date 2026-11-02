// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

/**
 * Node ships its own `localStorage` global, a getter that reads as undefined
 * unless node runs with --localstorage-file. Vitest's jsdom setup skips any key
 * already present on the global, so jsdom's implementation is never installed
 * and `window.localStorage` becomes undefined in DOM tests — which silently
 * killed 30 tests in the money-flow and support-chat suites.
 *
 * This file exists to fail if that ever happens again.
 */
describe("the jsdom test environment", () => {
  it("exposes a working localStorage", () => {
    window.localStorage.setItem("pryva:probe", "ok");
    expect(window.localStorage.getItem("pryva:probe")).toBe("ok");
    window.localStorage.clear();
    expect(window.localStorage.getItem("pryva:probe")).toBeNull();
  });

  it("exposes it through the global too", () => {
    expect(typeof localStorage.setItem).toBe("function");
    expect(localStorage).toBe(window.localStorage);
  });
});
