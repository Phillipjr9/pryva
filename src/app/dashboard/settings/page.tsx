import { requireUser } from "@/lib/auth";
import { SettingsForm } from "./SettingsForm";

// The dashboard layout already provides the shell — nesting it here rendered a
// second sidebar inside the content column.
export default async function SettingsPage() {
  const user = await requireUser("/dashboard/settings");

  return (
      <div className="space-y-6">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">
            Settings
          </h1>
          <p className="mt-2 text-[0.95rem] text-ink-2">
            Manage your account settings and preferences.
          </p>
        </div>
        <SettingsForm user={user} />
      </div>
  );
}
