"use client";

import { useEffect, useState } from "react";
import { Shield, AlertTriangle, Activity, Eye, Lock, Code } from "@/components/icons";

interface SecurityMetrics {
  totalViolations: number;
  devToolsDetections: number;
  debuggerDetections: number;
  injectionAttempts: number;
  scrapingAttempts: number;
  iframeDetections: number;
}

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

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/security/metrics", { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (data && !controller.signal.aborted) {
          setMetrics(data.metrics);
          setViolations(data.violations);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.error("Failed to fetch security data:", error);
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
        <h2 className="text-xl font-semibold text-ink mb-2">No Security Data</h2>
        <p className="text-ink-2">No security violations have been reported yet.</p>
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
        <MetricCard
          icon={<Eye className="h-6 w-6" />}
          label="DevTools Detections"
          value={metrics.devToolsDetections}
          color="text-orange-600"
          bgColor="bg-orange-50"
        />
        <MetricCard
          icon={<Code className="h-6 w-6" />}
          label="Debugger Detections"
          value={metrics.debuggerDetections}
          color="text-purple-600"
          bgColor="bg-purple-50"
        />
        <MetricCard
          icon={<Lock className="h-6 w-6" />}
          label="Injection Attempts"
          value={metrics.injectionAttempts}
          color="text-red-600"
          bgColor="bg-red-50"
        />
        <MetricCard
          icon={<Activity className="h-6 w-6" />}
          label="Scraping Attempts"
          value={metrics.scrapingAttempts}
          color="text-yellow-600"
          bgColor="bg-yellow-50"
        />
        <MetricCard
          icon={<Shield className="h-6 w-6" />}
          label="Iframe Detections"
          value={metrics.iframeDetections}
          color="text-blue-600"
          bgColor="bg-blue-50"
        />
      </div>

      {/* Recent Violations */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-ink mb-4">Recent Violations</h2>
        {violations.length === 0 ? (
          <p className="text-ink-2 text-center py-8">No recent violations</p>
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

      {/* Protection Status */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-ink mb-4">Active Protections</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <ProtectionStatus
            name="DevTools Detection"
            enabled={true}
            description="Detects when browser DevTools are open"
          />
          <ProtectionStatus
            name="Debugger Detection"
            enabled={true}
            description="Detects attached debuggers"
          />
          <ProtectionStatus
            name="Code Injection Detection"
            enabled={true}
            description="Detects code tampering attempts"
          />
          <ProtectionStatus
            name="Iframe Detection"
            enabled={true}
            description="Protects against clickjacking"
          />
          <ProtectionStatus
            name="Scraping Detection"
            enabled={true}
            description="Detects automated scraping"
          />
          <ProtectionStatus
            name="Honeypot Traps"
            enabled={true}
            description="Detects code analysis attempts"
          />
          <ProtectionStatus
            name="Browser Fingerprinting"
            enabled={true}
            description="Tracks unique browser signatures"
          />
          <ProtectionStatus
            name="Rate Limiting"
            enabled={true}
            description="Prevents abuse and DoS attacks"
          />
        </div>
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

function ProtectionStatus({
  name,
  enabled,
  description,
}: {
  name: string;
  enabled: boolean;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg bg-cream border border-line">
      <div
        className={`flex-shrink-0 w-2 h-2 rounded-full mt-2 ${
          enabled ? "bg-green-500" : "bg-gray-300"
        }`}
      />
      <div className="flex-1">
        <p className="font-medium text-ink">{name}</p>
        <p className="text-sm text-ink-2">{description}</p>
      </div>
      <span
        className={`text-xs font-medium px-2 py-1 rounded ${
          enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
        }`}
      >
        {enabled ? "Active" : "Disabled"}
      </span>
    </div>
  );
}
