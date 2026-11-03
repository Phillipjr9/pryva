import { SECURITY_CONTROLS, type SecurityControl } from "@/lib/security-controls";

const STATE_STYLES: Record<SecurityControl["state"], { chip: string; dot: string; label: string }> = {
  enforced: { chip: "bg-green-100 text-green-700", dot: "bg-green-500", label: "Running" },
  not_running: { chip: "bg-gray-100 text-gray-500", dot: "bg-gray-300", label: "Not running" },
};

/**
 * The controls panel, rendered on the server from the table in
 * `lib/security-controls.ts`. It used to live inside the client dashboard as eight
 * rows of `enabled={true}`, which is how the page came to claim detectors it has
 * never run.
 */
export function SecurityControls() {
  const enforced = SECURITY_CONTROLS.filter((control) => control.state === "enforced");
  const notRunning = SECURITY_CONTROLS.filter((control) => control.state === "not_running");

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink mb-1">Security controls</h2>
          <p className="max-w-2xl text-sm text-ink-2">
            Each control is marked by whether a request path actually runs it, not by whether the
            code exists. {notRunning.length} of these {SECURITY_CONTROLS.length} are written but
            never installed, so they have never produced a finding and the violation counts above
            cannot move on their own.
          </p>
        </div>
        <p className="text-sm text-ink-2">
          <span className="font-medium text-ink">{enforced.length} running</span> of{" "}
          {SECURITY_CONTROLS.length} listed
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {SECURITY_CONTROLS.map((control) => {
          const style = STATE_STYLES[control.state];
          return (
            <div
              key={control.id}
              className="flex items-start gap-3 p-4 rounded-lg bg-cream border border-line"
            >
              <div
                className={`flex-shrink-0 w-2 h-2 rounded-full mt-2 ${style.dot}`}
                aria-hidden
              />
              <div className="flex-1">
                <p className="font-medium text-ink">{control.label}</p>
                <p className="text-sm text-ink-2">{control.description}</p>
                <p className="mt-1 text-xs text-ink-3">{control.source}</p>
              </div>
              <span className={`text-xs font-medium px-2 py-1 rounded ${style.chip}`}>
                {style.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
