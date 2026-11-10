"use client";
import { useState } from "react";

type Result = { configured: boolean; account: null | { active: boolean; funds: { usd: string; rub: string }; returnedBalances: number; returnedCurrencies: string[] }; error: null | "auth" | "unavailable"; settings: { purchasesBlockedInEnvironment: boolean; mock: boolean; rateConfigured: boolean; rateSource: "manual" | "live" | "unavailable"; intentSecretConfigured: boolean; starsEnabled: boolean; codesEnabled: boolean; topupsEnabled: boolean; loginTopupsEnabled: boolean; confirmationsEnabled: boolean; esimsEnabled: boolean; reviewedCodes: number; reviewedDirectTopups: number; reviewedLoginTopups: number; reviewedEsims: number } };
const status = (enabled: boolean) => enabled ? "Enabled" : "Disabled";
export function FoxreloadCheck() {
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function check() {
    setBusy(true); setError(null); setData(null);
    try {
      const response = await fetch("/api/admin/foxreload", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error("Check unavailable.");
      setData(body as Result);
    } catch { setError("Could not run the check. Please sign in as an administrator and try again."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-line bg-white p-5">
    <button type="button" disabled={busy} onClick={check} className="rounded-xl bg-lav-700 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Checking…" : "Check account and settings"}</button>
    {error && <p role="alert" className="mt-3 text-rose-700">{error}</p>}
    {data && <div className="mt-4 space-y-3 text-sm text-ink-2" role="status">
      <p><strong>API key:</strong> {data.configured ? "Set" : "Not set in this deployment"}</p>
      <p><strong>Account:</strong> {data.account ? data.account.active ? "Authenticated and active" : "Authenticated but inactive" : data.error === "auth" ? "Authentication refused" : data.error === "unavailable" ? "Could not verify" : "Not checked"}</p>
      {data.account && <><p><strong>Available funds:</strong> USD {data.account.funds.usd}; RUB {data.account.funds.rub} (amounts hidden).</p><p>The account returned {data.account.returnedBalances} balance {data.account.returnedBalances === 1 ? "entry" : "entries"}{data.account.returnedCurrencies.length ? ` (${data.account.returnedCurrencies.join(", ")})` : " with no recognized currency"}. Unknown does not mean zero; check the account dashboard or contact support.</p></>}
      <p><strong>Environment:</strong> {data.settings.purchasesBlockedInEnvironment ? "Purchases blocked in this environment" : "Production purchase guard allows checkout"}; mock mode {data.settings.mock ? "on" : "off"}.</p>
      <p><strong>Pricing rate:</strong> {data.settings.rateConfigured ? data.settings.rateSource === "live" ? "Fresh reference rate" : "Manual rate" : "Unavailable"}; <strong>recipient binding secret:</strong> {data.settings.intentSecretConfigured ? "Set" : "Missing or invalid"}.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Telegram Stars: {status(data.settings.starsEnabled)}</li>
        <li>Codes: {status(data.settings.codesEnabled)}; {data.settings.reviewedCodes} reviewed offers</li>
        <li>Direct top-ups: {status(data.settings.topupsEnabled)}; {data.settings.reviewedDirectTopups} reviewed offers</li>
        <li>Login top-ups: {status(data.settings.loginTopupsEnabled)}; {data.settings.reviewedLoginTopups} reviewed offers; confirmation codes {status(data.settings.confirmationsEnabled).toLowerCase()}</li>
        <li>eSIMs: {status(data.settings.esimsEnabled)}; {data.settings.reviewedEsims} reviewed offers</li>
      </ul>
    </div>}
  </section>;
}
