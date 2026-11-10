/** Server-only Cloudflare analytics. The token never goes to the browser. */
import "server-only";

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const ZONE_ID = /^[a-f0-9]{32}$/i;
const EVENT_LIMIT = 100;

type Status<T> = { status: "ready"; data: T } | { status: "unavailable" };
export type CloudflareEvent = { datetime: string; action: string; source: string; country: string; ip: string; path: string };
export type TrafficHour = { datetime: string; requests: number; bytes: number };
export type CountGroup = { label: string; count: number };
export type TrafficBreakdown = { countries: CountGroup[]; paths: CountGroup[]; statuses: CountGroup[] };
export type SecurityBreakdown = { actions: CountGroup[]; services: CountGroup[]; rules: CountGroup[] };
export type CloudflareOverview = {
  configured: boolean;
  events?: Status<CloudflareEvent[]>;
  traffic?: Status<TrafficHour[]>;
  trafficBreakdown?: Status<TrafficBreakdown>;
  securityBreakdown?: Status<SecurityBreakdown>;
  eventLimit: number;
};

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, "").slice(0, max) : "";
}

async function graphql(token: string, query: string): Promise<unknown> {
  const response = await fetch(ENDPOINT, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Analytics unavailable");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || ("errors" in body && Array.isArray(body.errors) && body.errors.length)) throw new Error("Analytics unavailable");
  const data = body as { data?: { viewer?: { zones?: unknown[] } } };
  const zones = data.data?.viewer?.zones;
  if (!Array.isArray(zones) || zones.length !== 1 || !zones[0] || typeof zones[0] !== "object") throw new Error("Analytics unavailable");
  return zones[0];
}

/** Fixed, bounded groups. A malformed or unsupported feed is never reported as zero. */
function groups(value: unknown, dimension: string, limit: number): CountGroup[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error("Invalid analytics groups");
  return value.map((row) => {
    const label = row?.dimensions?.[dimension];
    if (!Number.isSafeInteger(row?.count) || row.count < 0 || (typeof label !== "string" && typeof label !== "number")) throw new Error("Invalid analytics group");
    const normalized = text(String(label), 500).split(/[?#]/, 1)[0];
    return { label: normalized || "Unknown", count: row.count };
  });
}

/** Last 24 complete UTC hours for traffic; events cover the rolling 24 hours. */
export async function readCloudflareOverview(now = new Date()): Promise<CloudflareOverview> {
  const zone = process.env.CLOUDFLARE_ANALYTICS_ZONE_ID?.trim() ?? "";
  const token = process.env.CLOUDFLARE_ANALYTICS_API_TOKEN?.trim() ?? "";
  // Never let a preview deployment use a production analytics credential.
  if (process.env.VERCEL_ENV === "preview" || !ZONE_ID.test(zone) || !token || /[\r\n]/.test(token)) return { configured: false, eventLimit: EVENT_LIMIT };
  const end = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  const start = new Date(end.getTime() - 24 * 3_600_000);
  const eventStart = new Date(now.getTime() - 24 * 3_600_000);
  const root = `viewer { zones(filter: {zoneTag: "${zone}"})`;
  const eventsQuery = `query { ${root} { firewallEventsAdaptive(limit: ${EVENT_LIMIT}, orderBy: [datetime_DESC], filter: {datetime_geq: "${eventStart.toISOString()}", datetime_leq: "${now.toISOString()}"}) { datetime action source clientCountryName clientIP clientRequestPath } } } }`;
  const trafficQuery = `query { ${root} { httpRequests1hGroups(limit: 24, orderBy: [datetime_ASC], filter: {datetime_geq: "${start.toISOString()}", datetime_lt: "${end.toISOString()}"}) { dimensions { datetime } sum { requests bytes } } } } }`;

  const rolling = `datetime_geq: "${eventStart.toISOString()}", datetime_lt: "${now.toISOString()}"`;
  // Separate requests keep existing feeds working if this plan does not support a dataset.
  const httpGroup = (alias: string, dimension: string, limit: number) => `${alias}: httpRequestsAdaptiveGroups(limit: ${limit}, orderBy: [count_DESC], filter: {${rolling}, requestSource: "eyeball"}) { count dimensions { ${dimension} } }`;
  const securityGroup = (alias: string, dimension: string, limit: number) => `${alias}: firewallEventsAdaptiveGroups(limit: ${limit}, orderBy: [count_DESC], filter: {${rolling}}) { count dimensions { ${dimension} } }`;
  const breakdownQuery = `query { ${root} { ${httpGroup("countries", "clientCountryName", 10)} ${httpGroup("paths", "clientRequestPath", 10)} ${httpGroup("statuses", "edgeResponseStatus", 50)} } } }`;
  const securityQuery = `query { ${root} { ${securityGroup("actions", "action", 20)} ${securityGroup("services", "source", 20)} ${securityGroup("rules", "ruleId", 10)} } } }`;
  const [eventsResult, trafficResult, breakdownResult, securityResult] = await Promise.allSettled([graphql(token, eventsQuery), graphql(token, trafficQuery), graphql(token, breakdownQuery), graphql(token, securityQuery)]);
  let events: CloudflareOverview["events"] = { status: "unavailable" };
  let traffic: CloudflareOverview["traffic"] = { status: "unavailable" };
  if (eventsResult.status === "fulfilled") {
    const rows = (eventsResult.value as { firewallEventsAdaptive?: unknown }).firewallEventsAdaptive;
    if (Array.isArray(rows) && rows.length <= EVENT_LIMIT && rows.every((r) => r && typeof r === "object" && typeof r.datetime === "string" && typeof r.action === "string" && typeof r.source === "string")) {
      events = { status: "ready", data: rows.map((r) => ({ datetime: text(r.datetime, 40), action: text(r.action, 50), source: text(r.source, 80), country: text(r.clientCountryName, 80), ip: text(r.clientIP, 80), path: text(r.clientRequestPath, 500).split(/[?#]/, 1)[0] })) };
    }
  }
  if (trafficResult.status === "fulfilled") {
    const rows = (trafficResult.value as { httpRequests1hGroups?: unknown }).httpRequests1hGroups;
    if (Array.isArray(rows) && rows.length <= 24 && rows.every((r) => r && typeof r.dimensions?.datetime === "string" && Number.isSafeInteger(r.sum?.requests) && r.sum.requests >= 0 && Number.isSafeInteger(r.sum?.bytes) && r.sum.bytes >= 0)) {
      traffic = { status: "ready", data: rows.map((r) => ({ datetime: text(r.dimensions.datetime, 40), requests: r.sum.requests, bytes: r.sum.bytes })) };
    }
  }
  let trafficBreakdown: CloudflareOverview["trafficBreakdown"] = { status: "unavailable" };
  let securityBreakdown: CloudflareOverview["securityBreakdown"] = { status: "unavailable" };
  if (breakdownResult.status === "fulfilled") {
    try {
      const row = breakdownResult.value as Record<string, unknown>;
      trafficBreakdown = { status: "ready", data: { countries: groups(row.countries, "clientCountryName", 10), paths: groups(row.paths, "clientRequestPath", 10), statuses: groups(row.statuses, "edgeResponseStatus", 50) } };
    } catch { /* unsupported or malformed data */ }
  }
  if (securityResult.status === "fulfilled") {
    try {
      const row = securityResult.value as Record<string, unknown>;
      securityBreakdown = { status: "ready", data: { actions: groups(row.actions, "action", 20), services: groups(row.services, "source", 20), rules: groups(row.rules, "ruleId", 10) } };
    } catch { /* unsupported or malformed data */ }
  }
  return { configured: true, events, traffic, trafficBreakdown, securityBreakdown, eventLimit: EVENT_LIMIT };
}
