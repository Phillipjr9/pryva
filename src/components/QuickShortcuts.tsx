"use client";

import { useId, useState } from "react";

export type QuickShortcut = { key: string; label: string };

/** A compact, keyboard-accessible list that can grow without rendering a huge catalogue at once. */
export function QuickShortcuts({
  label, title, description, options, selected, onSelect, onClear, clearLabel = "Clear quick search", alwaysShowClear = false,
}: {
  label: string;
  title: string;
  description: string;
  options: readonly QuickShortcut[];
  selected: string | null;
  onSelect: (key: string) => void;
  onClear: () => void;
  clearLabel?: string;
  alwaysShowClear?: boolean;
}) {
  const listId = useId();
  const [visible, setVisible] = useState(12);
  if (!options.length && !selected) return null;

  // A newly loaded page can reorder the choices. Keep the active choice visible
  // even if it moved outside the first page of shortcuts.
  const shown = options.slice(0, visible);
  const active = selected ? options.find((option) => option.key === selected) : undefined;
  if (active && !shown.some((option) => option.key === active.key)) shown.push(active);
  const remaining = options.length - shown.length;

  return <div role="group" aria-label={label} className="mt-4 min-w-0">
    <p className="text-meta font-semibold text-ink">{title}</p>
    <p className="mt-1 text-micro leading-relaxed text-ink-3">{description}</p>
    <div id={listId} className={`relative mt-2 flex max-w-full flex-wrap gap-2 ${visible > 12 ? "max-h-60 overflow-y-auto overscroll-contain pr-1" : ""}`}>
      {shown.map((option) => <button
        key={option.key}
        type="button"
        aria-pressed={selected === option.key}
        onClick={() => onSelect(option.key)}
        className={`min-h-10 max-w-full rounded-full border px-3 py-1.5 text-left text-meta font-medium [overflow-wrap:anywhere] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lav-600 ${selected === option.key ? "border-lav-600 bg-lav-700 text-white" : "border-line bg-white text-lav-700 hover:border-lav-300"}`}
      >{option.label}</button>)}
    </div>
    {(remaining > 0 || visible > 12 || selected || alwaysShowClear) && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-meta font-semibold text-lav-700">
      {remaining > 0 && <button type="button" aria-controls={listId} onClick={() => setVisible((count) => count + 24)} className="min-h-9 hover:underline">Show more shortcuts ({remaining} remaining)</button>}
      {visible > 12 && <button type="button" aria-controls={listId} onClick={() => setVisible(12)} className="min-h-9 hover:underline">Show fewer shortcuts</button>}
      {(selected || alwaysShowClear) && <button type="button" onClick={onClear} className="min-h-9 hover:underline">{clearLabel}</button>}
    </div>}
  </div>;
}
