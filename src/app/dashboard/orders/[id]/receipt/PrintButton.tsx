"use client";



/**
 * Print, which is also "Save as PDF" in every browser's print dialogue.
 *
 * `window.print()` is deliberately the only mechanism: it prints the DOM the
 * customer is looking at, so the PDF cannot drift from the sheet. The label says
 * both things, because "print" alone does not tell anyone that the PDF they
 * want comes out of the same button.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-xl bg-lav-700 px-4 py-2.5 text-meta font-semibold text-white transition-colors hover:bg-lav-800 print:hidden"
    >

      Print or save as PDF
    </button>
  );
}
