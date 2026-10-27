import { requireUser } from "@/lib/auth";
import { SessionsCard } from "./SessionsCard";
import { Shield } from "@/components/icons";
import Link from "next/link";

// Shell comes from the dashboard layout; this page supplies content only.
export default async function SecurityPage() {
  await requireUser("/dashboard/security");

  return (
      <div className="space-y-6">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">
            Security
          </h1>
          <p className="mt-2 text-[0.95rem] text-ink-2">
            Manage your account security settings.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {/* Password Security */}
          <div className="rounded-2xl border border-line bg-white p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-lav-100 text-lav-600">
                <Shield className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-[1rem] font-semibold text-ink mb-2">
                  Password
                </h3>
                <p className="text-[0.86rem] text-ink-2 mb-4">
                  Change your password to keep your account secure. Use a strong, unique password.
                </p>
                <Link
                  href="/dashboard/settings"
                  className="inline-flex items-center gap-2 rounded-xl bg-lav-600 px-4 py-2 text-[0.86rem] font-semibold text-white hover:bg-lav-700"
                >
                  Change Password
                </Link>
              </div>
            </div>
          </div>

          {/* Two-Factor Authentication */}
          <div className="rounded-2xl border border-line bg-white p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-green-100 text-green-600">
                <Shield className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-[1rem] font-semibold text-ink mb-2">
                  Two-Factor Authentication
                </h3>
                <p className="text-[0.86rem] text-ink-2 mb-4">
                  Add an extra layer of security to your account with 2FA.
                </p>
                <span className="inline-flex items-center gap-2 rounded-xl bg-gray-100 px-4 py-2 text-[0.86rem] font-semibold text-gray-500">
                  Coming Soon
                </span>
              </div>
            </div>
          </div>

          <SessionsCard />

          {/* Login History */}
          <div className="rounded-2xl border border-line bg-white p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-orange-100 text-orange-600">
                <Shield className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-[1rem] font-semibold text-ink mb-2">
                  Login History
                </h3>
                <p className="text-[0.86rem] text-ink-2 mb-4">
                  View your recent login activity and locations.
                </p>
                <span className="inline-flex items-center gap-2 rounded-xl bg-gray-100 px-4 py-2 text-[0.86rem] font-semibold text-gray-500">
                  Coming Soon
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Security Tips */}
        <div className="rounded-2xl border border-line bg-cream p-6">
          <h3 className="text-[1rem] font-semibold text-ink mb-4">
            Security Tips
          </h3>
          <ul className="space-y-3 text-[0.86rem] text-ink-2">
            <li className="flex items-start gap-2">
              <span className="text-lav-600 font-bold">•</span>
              Use a strong, unique password that you don&apos;t use on other sites
            </li>
            <li className="flex items-start gap-2">
              <span className="text-lav-600 font-bold">•</span>
              Never share your password or gift card codes with anyone
            </li>
            <li className="flex items-start gap-2">
              <span className="text-lav-600 font-bold">•</span>
              Enable two-factor authentication when available
            </li>
            <li className="flex items-start gap-2">
              <span className="text-lav-600 font-bold">•</span>
              Log out of shared devices after use
            </li>
            <li className="flex items-start gap-2">
              <span className="text-lav-600 font-bold">•</span>
              Be cautious of phishing emails asking for your credentials
            </li>
          </ul>
        </div>
      </div>
  );
}
