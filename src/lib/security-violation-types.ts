/**
 * The values stored in `security_violations.type`.
 *
 * Both ends of this table need the same list. The writer is
 * `app/api/security/report/route.ts`, which turns the sentences the client
 * detects into one of these; the reader is `app/api/admin/security/metrics/route.ts`,
 * which counts them for the owner's dashboard, and the dashboard renders a tile
 * for each.
 *
 * They used to be three separate lists -- the writer had five fixed sentences plus
 * one prefix rule, the reader counted five, and the dashboard drew five tiles. So
 * a `modified_environment` row was included in "Total Violations" and in nothing
 * else on the page: invisible in the only place the owner looks, while the tiles
 * beside it quietly failed to add up to the number above them. Written once, the
 * reader walks the list and cannot leave one out.
 *
 * The names are not secret: they are already in the admin payload. Client code
 * imports the labels, so they must stay free of anything the customer should not
 * see -- which is why they describe the *event*, not the detector or the supplier.
 */
export type SecurityViolationType =
  | "devtools"
  | "debugger"
  | "injection"
  | "iframe"
  | "modified_environment"
  | "scraping";

export type SecurityViolationSpec = {
  /** What goes in `security_violations.type`. */
  type: SecurityViolationType;
  /** The tile label on the admin security page. */
  label: string;
  /**
   * The sentence the client sends for it. `prefix` means the client appends what it
   * saw, so the sentence only has to start this way.
   */
  report: { value: string; match: "exact" | "prefix" };
};

export const SECURITY_VIOLATION_TYPES: readonly SecurityViolationSpec[] = [
  {
    type: "devtools",
    label: "DevTools opened",
    report: { value: "DevTools detected", match: "exact" },
  },
  {
    type: "debugger",
    label: "Debugger attached",
    report: { value: "Debugger attached", match: "exact" },
  },
  {
    type: "injection",
    label: "Code injection",
    report: { value: "Code injection detected", match: "exact" },
  },
  {
    type: "iframe",
    label: "Page framed",
    report: { value: "Running in iframe", match: "exact" },
  },
  {
    type: "modified_environment",
    label: "Modified environment",
    report: { value: "Modified environment detected", match: "exact" },
  },
  {
    type: "scraping",
    label: "Automated access",
    report: { value: "Scraping detected: ", match: "prefix" },
  },
];

/**
 * Which stored type a client sentence means, or null when it means nothing.
 *
 * A report that matches nothing must stay a rejection rather than a guess: these
 * rows are untrusted telemetry, and an unknown sentence is either a patched client
 * or a forged body. Both are answered by refusing, not by filing them somewhere.
 */
export function violationTypeFor(report: string): SecurityViolationType | null {
  for (const spec of SECURITY_VIOLATION_TYPES) {
    if (spec.report.match === "exact" ? report === spec.report.value : report.startsWith(spec.report.value)) {
      return spec.type;
    }
  }
  return null;
}
