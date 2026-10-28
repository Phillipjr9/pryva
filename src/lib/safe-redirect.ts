/** Accept only an unambiguous same-origin absolute path, never a URL or //host. */
export function safeRedirectPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") ||
      value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value) ||
      /^\/%(?:2f|5c)/i.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)) {
    return fallback;
  }
  try {
    if (new URL(value, "https://local.invalid").origin !== "https://local.invalid") return fallback;
    return value;
  } catch {
    return fallback;
  }
}
