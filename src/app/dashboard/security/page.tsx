import { redirect } from "next/navigation";

/**
 * Security moved inside Settings.
 *
 * Password, two-factor and sessions are properties of one account, so they live
 * on the page that edits that account. Two sibling pages that both sounded right
 * meant a customer looking for "turn on 2FA" had to guess, and the page they
 * guessed first had no mention of it.
 *
 * This route stays as a redirect rather than a 404 so that everything that
 * already points here keeps working: old bookmarks, the admin sign-in bounce
 * (`require=2fa`), the command palette, and any support reply sent before the
 * move. The query string is carried across, because dropping `require=2fa` would
 * land an administrator on a page with no explanation of why the admin area
 * just refused them.
 */
export default async function SecurityRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") search.set(key, value);
    else if (Array.isArray(value) && typeof value[0] === "string") search.set(key, value[0]);
  }

  const query = search.toString();
  redirect(`/dashboard/settings${query ? `?${query}` : ""}#security`);
}
