/** Server-only Cloudflare analytics. The token never goes to the browser. */
import "server-only";

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const ZONE_ID = /^[a-f0-9]{32}$/i;
const EVENT_LIMIT = 100;

type Status<T> = { status: "ready"; data: T } | { status: "unavailable" };
export type CloudflareEvent = { datetime: string; action: string; source: string; country: string; ip: string; path: string };
export type TrafficHour = { datetime: string; requests: number; bytes: number };
export type CloudflareOverview = {
  configured: boolean;
  events?: Status<CloudflareEvent[]>;
  traffic?: Status<TrafficHour[]>;
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

  const [eventsResult, trafficResult] = await Promise.allSettled([graphql(token, eventsQuery), graphql(token, trafficQuery)]);
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
  return { configured: true, events, traffic, eventLimit: EVENT_LIMIT };
}
