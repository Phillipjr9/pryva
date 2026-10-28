import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ callbacks: [] as Array<() => React.ReactNode> }));
vi.mock("next/navigation", () => ({
  useServerInsertedHTML: (callback: () => React.ReactNode) => mocks.callbacks.push(callback),
}));
import { BuildGuard } from "@/components/system/BuildGuard";

describe("streamed build guard", () => {
  it("inserts one guard even when Next flushes server-inserted HTML repeatedly", () => {
    mocks.callbacks.length = 0;
    renderToStaticMarkup(<BuildGuard buildId="test-build" />);
    expect(mocks.callbacks).toHaveLength(1);
    const first = mocks.callbacks[0]();
    expect(renderToStaticMarkup(<>{first}</>)).toContain('id="pryva-build-guard"');
    expect(mocks.callbacks[0]()).toBeNull();
    expect(mocks.callbacks[0]()).toBeNull();
  });
});
