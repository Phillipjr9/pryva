/** Shared lockup for every transactional email, including the specialised templates. */
export function emailBrandLockup(siteUrl: string): string {
  const safeUrl = siteUrl.replace(/\/+$/, "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:10px;vertical-align:middle;"><img src="${safeUrl}/images/brand/pryva-mark.png" width="38" height="38" alt="Pryva" style="display:block;width:38px;height:38px;border:0;outline:none;text-decoration:none;"></td>
    <td style="font-family:'Manrope',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:26px;line-height:1;font-weight:700;letter-spacing:-1.3px;color:#29223a;vertical-align:middle;">Pryva</td>
  </tr></table>`;
}
