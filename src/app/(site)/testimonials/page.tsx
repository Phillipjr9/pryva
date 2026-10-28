import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Testimonials",
  description: "Customer feedback about Pryva.",
};

export default function TestimonialsPage() {
  return (
    <div className="min-h-screen bg-cream py-16">
      <div className="shell max-w-2xl text-center">
        <h1 className="text-4xl font-medium tracking-tight text-ink">Customer feedback</h1>
        <div className="mt-8 rounded-2xl border border-line bg-white p-8">
          <p className="leading-7 text-ink-2">There are no verified customer testimonials to display here yet.</p>
          <p className="mt-3 text-sm text-ink-3">For questions or feedback about an existing order, contact support.</p>
          <Link href="/contact" className="btn btn-primary mt-6">Contact support</Link>
        </div>
      </div>
    </div>
  );
}
