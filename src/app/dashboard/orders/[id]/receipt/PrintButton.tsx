"use client";

/** Print, which is also "Save as PDF" in every browser's print dialogue. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-xl bg-lav-600 px-4 py-2.5 text-meta font-semibold text-white hover:bg-lav-700 print:hidden"
    >
      Print or save as PDF
    </button>
  );
}
