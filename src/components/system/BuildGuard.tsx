"use client";

import { useRef } from "react";
import { useServerInsertedHTML } from "next/navigation";
import { staleBuildScript } from "@/lib/build-id";

/**
 * Injects the stale-build check into the server HTML without React ever
 * rendering a script element.
 *
 * Three things had to line up, and each was learned from a real failure:
 *
 * 1. It must live in the HTML, not in a component — a tab one build behind is
 *    running the old JavaScript, so a React-based guard is missing precisely
 *    where it is needed.
 * 2. It must not be a `<script>` element rendered by React: React refuses to
 *    execute those on the client and logs "Encountered a script tag while
 *    rendering React component" — verified twice, with a bare tag and with
 *    next/script.
 * 3. It must run before hydration, otherwise the mismatch has already been
 *    reported by the time the check finishes.
 *
 * `useServerInsertedHTML` satisfies all three: the markup is streamed into the
 * document server-side and never becomes part of the client tree.
 */
export function BuildGuard({ buildId }: { buildId: string }) {
  const inserted = useRef(false);
  useServerInsertedHTML(() => {
    // Next can flush server-inserted HTML multiple times while streaming a page.
    // Install one guard, not a fresh set of listeners and version requests per flush.
    if (inserted.current) return null;
    inserted.current = true;
    return (
      <script
        id="pryva-build-guard"
        data-build={buildId}
        dangerouslySetInnerHTML={{ __html: staleBuildScript(buildId) }}
      />
    );
  });

  return null;
}
