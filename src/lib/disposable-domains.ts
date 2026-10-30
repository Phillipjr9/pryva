/**
 * Addresses that cannot be used to create an account.
 *
 * Pryva *sells* temporary inboxes, so this is not a moral position on them — it
 * is a rule about the one address that identifies an account. A throwaway inbox
 * is deleted by design, which breaks everything an account depends on:
 *
 *   * the verification link in `issueEmailVerification`,
 *   * password resets (the only self-service way back into an account),
 *   * receipts and refund notices,
 *   * any contact an operator needs to make about money already spent.
 *
 * It is also the cheapest way to farm accounts: no cost, no identity, and a new
 * address per request. Signup already has an IP budget and an email-verification
 * step; refusing the domains that exist only to be discarded closes the gap
 * those two leave.
 *
 * ## What this is not
 *
 * This is a speed bump, not a wall. A determined attacker can register a domain
 * and use it once. The list covers the providers people actually reach for, so
 * the casual path is closed, and the per-IP signup budget plus verification
 * still bound the determined one. Anyone who needs to sign up for a living
 * (an operator testing in production, say) can use a normal mailbox.
 *
 * ## Maintenance
 *
 * Domains are matched on the registrable name and on any subdomain of it, so
 * `anything.mailinator.com` is caught without listing every alias. Do not add a
 * domain that also serves ordinary mailboxes: blocking `gmail.com` because
 * "someone could use plus-addressing" locks out most of the country. A test
 * pins the providers that must never appear here.
 */

/** Providers whose whole purpose is an inbox that expires. */
export const DISPOSABLE_EMAIL_DOMAINS = [
  // Mailinator family
  "mailinator.com",
  "mailinator.net",
  "mailinator2.com",
  "notmailinator.com",
  "reallymymail.com",
  "safetymail.info",
  "spamherelots.com",
  "thisisnotmyrealemail.com",
  // Guerrilla Mail
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.biz",
  "guerrillamail.de",
  "guerrillamailblock.com",
  "grr.la",
  "sharklasers.com",
  "spam4.me",
  // Ten-minute family
  "10minutemail.com",
  "10minutemail.net",
  "10minutemail.org",
  "10minutemail.co.uk",
  "10minutemail.de",
  "10minutemail.be",
  "10minutemail.us",
  "10minutemail.info",
  "10minutemail.co.za",
  "10minutemail.ga",
  "10minutemailbox.com",
  "10minutemails.in",
  "10minemail.com",
  "tempmail.com",
  "tempmail.net",
  "tempmail.org",
  "tempmailo.com",
  "tempmail.plus",
  "tempmailaddress.com",
  "temp-mail.org",
  "temp-mail.io",
  "temp-mail.de",
  "temp-mail.ru",
  "tempr.email",
  "tempinbox.com",
  "tempinbox.co.uk",
  "temporary-mail.net",
  "temporaryemail.net",
  "temporaryemail.us",
  "temporarymail.com",
  "throwawaymail.com",
  "throwaway.email",
  "discard.email",
  "discardmail.com",
  "discardmail.de",
  "trashmail.com",
  "trashmail.de",
  "trashmail.net",
  "trashmail.ws",
  "trash-mail.com",
  "trash-mail.de",
  "mytrashmail.com",
  "wegwerfmail.de",
  "wegwerfemail.de",
  "müllmail.de",
  "einmalmail.de",
  // YOPmail
  "yopmail.com",
  "yopmail.net",
  "yopmail.fr",
  "cool.fr.nf",
  "jetable.fr.nf",
  "nospam.ze.tc",
  "nomail.xl.cx",
  "mega.zik.dj",
  "speed.1s.fr",
  "courriel.fr.nf",
  "moncourrier.fr.nf",
  "monemail.fr.nf",
  "monmail.fr.nf",
  // Mail drop / spamgourmet
  "maildrop.cc",
  "mailnesia.com",
  "mailcatch.com",
  "mailnull.com",
  "spamgourmet.com",
  "spamgourmet.net",
  "spamgourmet.org",
  "getairmail.com",
  "filzmail.com",
  "mailsac.com",
  "inboxkitten.com",
  "mailforspam.com",
  // Miscellaneous providers
  "fakeinbox.com",
  "fakemailgenerator.com",
  "fakemail.fr",
  "emailondeck.com",
  "getnada.com",
  "nada.email",
  "spambox.us",
  "spambog.com",
  "spambog.de",
  "spambog.ru",
  "burnermail.io",
  "moakt.com",
  "mohmal.com",
  "vomoto.com",
  "emailtemporario.com.br",
  "correotemporal.org",
  "linshiyouxiang.net",
  "mytemp.email",
  "anonbox.net",
  "anonymbox.com",
  "binkmail.com",
  "bobmail.info",
  "devnullmail.com",
  "letthemeatspam.com",
  "mailismagic.com",
  "mt2009.com",
  "rppkn.com",
  "tradermail.info",
  "veryrealemail.com",
  "zippymail.info",
  "buymailbox.net",
  "tempmail.ninja",
  "tempail.com",
  "emailfake.com",
  "generator.email",
  "cock.li",
  "airmail.cc",
] as const;

const BLOCKED = new Set<string>(DISPOSABLE_EMAIL_DOMAINS);

/**
 * Providers that hand every visitor a fresh subdomain. Suffix matching matters
 * for these: `abc123.mailinator.com` must be refused as surely as the parent.
 */
const SUFFIX_MATCHED = new Set([
  "mailinator.com",
  "mailinator.net",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "yopmail.com",
  "yopmail.net",
  "yopmail.fr",
  "getnada.com",
  "maildrop.cc",
  "mailsac.com",
  "inboxkitten.com",
]);

/** The text a signup is refused with. Kept here so copy and rule cannot drift. */
export const DISPOSABLE_EMAIL_ERROR =
  "Please use an email address you'll keep. Temporary inboxes are deleted by design, so your verification link, receipts and password resets would never reach you.";

/** The part after the last `@`, lowercased. Empty string when there is no `@`. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
}

/** True when the address belongs to a provider that exists to be discarded. */
export function isDisposableEmailAddress(email: string): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  if (BLOCKED.has(domain)) return true;
  for (const provider of SUFFIX_MATCHED) {
    if (domain.endsWith(`.${provider}`)) return true;
  }
  return false;
}
