/** Accept only trustworthy non-negative whole counts, including a real zero. */
export function safeUnitCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function formatUnitCount(value: unknown, unavailable: string): string {
  const count = safeUnitCount(value);
  return count === null ? unavailable : `${count.toLocaleString("en-NG")} left`;
}
