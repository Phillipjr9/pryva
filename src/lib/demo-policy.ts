/** Demo accounts and introductory credit must never be backed by a real database. */
export const DEMO_EMAIL = "demo@pryva.ng";
export const PREVIEW_WELCOME_CREDIT = 5000;

export function isPreviewDatabase(): boolean {
  return !process.env.DATABASE_URL?.trim();
}

export function isDemoEmail(email: string): boolean {
  return email.trim().toLowerCase() === DEMO_EMAIL;
}
