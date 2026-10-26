import { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { CheckCircle, Clock } from "@/components/icons";

export const metadata: Metadata = {
  title: "System Status",
  description: "Current status of Pryva services and infrastructure.",
};

const services = [
  { name: "Virtual Numbers API", status: "operational", uptime: "99.98%" },
  { name: "eSIM Delivery", status: "operational", uptime: "99.95%" },
  { name: "Residential Proxies", status: "operational", uptime: "99.92%" },
  { name: "Email OTP", status: "operational", uptime: "99.97%" },
  { name: "Payment Processing", status: "operational", uptime: "99.99%" },
  { name: "Wallet System", status: "operational", uptime: "100%" },
  { name: "Dashboard", status: "operational", uptime: "99.96%" },
  { name: "Support System", status: "operational", uptime: "99.94%" },
];

const incidents = [
  {
    date: "2024-01-10",
    title: "Scheduled Maintenance",
    description: "Brief maintenance window for database optimization. All services remained operational.",
    status: "resolved",
    duration: "15 minutes",
  },
  {
    date: "2023-12-20",
    title: "Payment Provider Delay",
    description: "Temporary delays in payment processing due to upstream provider issues. Resolved within 2 hours.",
    status: "resolved",
    duration: "2 hours",
  },
];

export default function StatusPage() {
  return (
    <div className="min-h-screen bg-cream dark:bg-gray-900">
      {/* Header */}
      <header className="border-b border-line bg-white dark:bg-gray-800 dark:border-gray-700">
        <div className="shell flex h-16 items-center justify-between">
          <Link href="/">
            <Logo />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-[0.86rem] font-medium text-ink-2 hover:text-ink dark:text-gray-400 dark:hover:text-gray-100"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-xl bg-lav-600 px-4 py-2 text-[0.86rem] font-semibold text-white hover:bg-lav-700 dark:bg-lav-500 dark:hover:bg-lav-600"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16">
        <div className="shell text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-green-100 px-4 py-2 mb-6 dark:bg-green-900/30">
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
            <span className="text-[0.9rem] font-semibold text-green-700 dark:text-green-300">
              All Systems Operational
            </span>
          </div>
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3rem] dark:text-gray-100">
            System Status
          </h1>
          <p className="mt-4 text-[1.1rem] text-ink-2 dark:text-gray-400 max-w-2xl mx-auto">
            Real-time status of all Pryva services and infrastructure.
          </p>
        </div>
      </section>

      {/* Services Status */}
      <section className="pb-16">
        <div className="shell max-w-3xl">
          <h2 className="text-[1.5rem] font-semibold text-ink mb-6 dark:text-gray-100">
            Service Status
          </h2>
          <div className="space-y-3">
            {services.map((service) => (
              <div
                key={service.name}
                className="flex items-center justify-between rounded-xl border border-line bg-white p-4 dark:bg-gray-800 dark:border-gray-700"
              >
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <div>
                    <p className="text-[0.95rem] font-medium text-ink dark:text-gray-100">
                      {service.name}
                    </p>
                    <p className="text-[0.78rem] text-ink-3 dark:text-gray-500">
                      Uptime: {service.uptime}
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-green-100 px-3 py-1 text-[0.72rem] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300">
                  Operational
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Recent Incidents */}
      <section className="pb-16">
        <div className="shell max-w-3xl">
          <h2 className="text-[1.5rem] font-semibold text-ink mb-6 dark:text-gray-100">
            Recent Incidents
          </h2>
          <div className="space-y-4">
            {incidents.map((incident, index) => (
              <div
                key={index}
                className="rounded-xl border border-line bg-white p-6 dark:bg-gray-800 dark:border-gray-700"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h3 className="text-[1rem] font-semibold text-ink dark:text-gray-100">
                      {incident.title}
                    </h3>
                    <p className="text-[0.82rem] text-ink-3 dark:text-gray-500">
                      {new Date(incident.date).toLocaleDateString("en-NG", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                  <span className="rounded-full bg-green-100 px-3 py-1 text-[0.72rem] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300">
                    {incident.status}
                  </span>
                </div>
                <p className="text-[0.86rem] text-ink-2 mb-3 dark:text-gray-400">
                  {incident.description}
                </p>
                <div className="flex items-center gap-2 text-[0.78rem] text-ink-3 dark:text-gray-500">
                  <Clock className="h-3.5 w-3.5" />
                  Duration: {incident.duration}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
