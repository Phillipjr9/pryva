"use client";

import { useEffect, useState } from "react";
import { Shield, AlertTriangle, Activity, Eye, Lock, Code } from "@/components/icons";
import { SECURITY_VIOLATION_TYPES } from "@/lib/security-violation-types";

interface SecurityMetrics {
  totalViolations: number;
  byType: Record<string, number>;
}

/** Cycled across the tile list, so a type added to the vocabulary gets a tile without an edit here. */
const TILE_ICONS = [Eye, Code, Lock, Activity, AlertTriangle, Shield];

interface ViolationLog {
  id: string;
  userId: string;
  userEmail: string;
  type: string;
  details: string;
  timestamp: string;
  ip?: string;
  url?: string;
}

export function SecurityDashboard() {
  const [metrics, setMetrics] = useState<SecurityMetrics | null>(null);
  const [violations, setViolations] = useState<ViolationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/security/metrics", { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data) {
          setMetrics(data.metrics);
          setViolations(data.violations);
        } else {
          setUnavailable(true);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error("Failed to fetch security data:", error);
          setUnavailable(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lav-600 mx-auto"></div>
        <p className="mt-4 text-ink-2">Loading security data...</p>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="card p-8 text-center">
        <Shield className="h-16 w-16 text-ink-3 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-ink mb-2">
          {unavailable ? "Security data could not be loaded" : "No security violations recorded"}
        </h2>
        <p className="text-ink-2">
          {unavailable
            ? "This is a failed request, not an empty table: the counts are unknown, not zero."
            : "Nothing has been written to the violations table yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Metrics Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          icon={<AlertTriangle className="h-6 w-6" />}
          label="Total Violations"
          value={metrics.totalViolations}
          color="text-red-600"
          bgColor="bg-red-50"
        />
        {SECURITY_VIOLATION_TYPES.map((spec, index) => {
          const Icon = TILE_ICONS[index % TILE_ICONS.length];
          return (
            <MetricCard
              key={spec.type}
              icon={<Icon className="h-6 w-6" />}
              label={spec.label}
              value={metrics.byType[spec.type] ?? 0}
              color="text-orange-600"
              bgColor="bg-orange-50"
            />
          );
        })}
      </div>

      {/* Recent Violations */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-ink mb-4">Recent Violations</h2>
        {violations.length === 0 ? (
          <p className="text-ink-2 text-center py-8">
            No recent violations. Only a browser running the client detector can add a row here, and
            no page installs that detector today — the controls below say which ones that is.
          </p>
        ) : (
          <div className="space-y-3">
            {violations.slice(0, 10).map((violation) => (
              <div
                key={violation.id}
                className="flex items-start gap-4 p-4 rounded-lg bg-cream border border-line"
              >
                <div className="flex-shrink-0">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-medium text-ink capitalize">
                      {violation.type.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-ink-3">
                      {new Date(violation.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-ink-2 mb-1">{violation.details}</p>
                  <div className="flex items-center gap-4 text-xs text-ink-3">
                    <span>User: {violation.userEmail}</span>
                    {violation.ip && <span>IP: {violation.ip}</span>}
                  </div>
                  {violation.url && (
                    <p className="text-xs text-ink-3 mt-1 truncate">URL: {violation.url}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  color,
  bgColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  bgColor: string;
}) {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-3 rounded-lg ${bgColor} ${color}`}>{icon}</div>
      </div>
      <p className="text-sm text-ink-2 mb-1">{label}</p>
      <p className="text-3xl font-bold text-ink">{value}</p>
    </div>
  );
}
