"use client";

import { AlertTriangle, Refresh } from "@/components/icons";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="card console-error" role="alert"><AlertTriangle /><h1>We couldn’t load this page</h1><p>The request did not finish. Your records have not been changed by this page load. Try again, or return to the dashboard.</p><div className="d-flex justify-content-center gap-2"><button type="button" className="btn btn-primary" onClick={reset}><Refresh />Try again</button><a href="/admin" className="btn btn-outline-secondary">Dashboard</a></div></div>;
}
