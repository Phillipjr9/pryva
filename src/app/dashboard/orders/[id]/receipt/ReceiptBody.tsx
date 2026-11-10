import { BrandMark } from "@/components/brand/BrandLockup";
import { formatNaira } from "@/lib/services/catalog";
import {
  RECEIPT_DOCUMENT_TITLE,
  RECEIPT_FOOTER,
  RECEIPT_SUPPORT_LINE,
  receiptLineItems,
  receiptServiceName,
  receiptStatusLabel,
  receiptStatusNote,
  receiptStatusTone,
  type ReceiptData,
} from "@/lib/payments/receipt";

/**
 * One order, as a document.
 *
 * Presentational on purpose: the page fetches and authorises, this renders, and a
 * test can print it without a database. Nothing here reads `provider` -- the field
 * exists on the row and must never reach a customer, least of all on paper.
 *
 * The layout is a paid invoice, not a list of key/value pairs: a letterhead, a
 * billed-to block, a dated document number, one priced item, a single total, and a
 * footnote that says what the document is not. That order is what a bank clerk,
 * an accountant or a customs officer looks for, and putting the reference in the
 * letterhead means a photocopy still identifies itself if the bottom half is lost.
 *
 * `print-document` is load-bearing: globals.css hides the rest of the app for
 * print and drops this element's card chrome, so the sheet that comes out of the
 * printer is this article and nothing else.
 */
export type { ReceiptData };

const TONE_CLASS: Record<ReturnType<typeof receiptStatusTone>, string> = {
  settled: "border-emerald-200 bg-emerald-50 text-emerald-900",
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  reversed: "border-line bg-cream-2 text-ink-2",
};

const TONE_DOT: Record<ReturnType<typeof receiptStatusTone>, string> = {
  settled: "bg-emerald-500",
  pending: "bg-amber-500",
  reversed: "bg-ink-3",
};

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-micro font-semibold uppercase tracking-[0.12em] text-ink-3">{label}</dt>
      <dd
        className={`mt-1 text-[0.875rem] leading-snug text-ink ${mono ? "font-mono tabular-nums break-all" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

export function ReceiptBody({ receipt }: { receipt: ReceiptData }) {
  const tone = receiptStatusTone(receipt.status);
  const statusLabel = receiptStatusLabel(receipt.status);
  const amountLabel = formatNaira(receipt.amount);
  const items = receiptLineItems(receipt, amountLabel);
  const refunded = receipt.refundedAt ?? null;
  const statusNote = receiptStatusNote(receipt.status, refunded);

  return (
    <article
      className="print-document mx-auto w-full max-w-[720px] overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-card)] print:max-w-none"
      aria-labelledby="receipt-title"
    >
      {/* Letterhead ------------------------------------------------------- */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-5 sm:px-8 sm:py-6">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark size="md" />
          <div className="min-w-0">
            <p className="text-[1rem] font-semibold leading-tight tracking-tight text-ink">PryvaLogs</p>
            <p className="text-meta leading-tight text-ink-3">pryvalogs.com</p>
          </div>
        </div>
        {/* Stacks under the mark on a phone and sits right on a wider screen:
            a wrapped flex item that keeps `text-right` reads as a mistake. */}
        <div className="w-full border-t border-line pt-3 text-left sm:w-auto sm:border-0 sm:pt-0 sm:text-right">
          <h1
            id="receipt-title"
            className="text-micro font-bold uppercase tracking-[0.16em] text-ink-3"
          >
            {RECEIPT_DOCUMENT_TITLE}
          </h1>
          <p className="mt-1 font-mono text-[0.9375rem] font-semibold tabular-nums text-ink">
            {receipt.reference}
          </p>
          <p className="mt-1 text-meta text-ink-3 [text-wrap:pretty]">{receipt.createdAt}</p>
        </div>
      </header>

      {/*
        Billed to / paid with.
        A document that does not name the buyer cannot be filed by the buyer.
      */}
      <section className="grid gap-4 border-b border-line px-5 py-5 sm:grid-cols-2 sm:px-8">
        <div className="min-w-0">
          <p className="text-micro font-semibold uppercase tracking-[0.12em] text-ink-3">Billed to</p>
          <p className="mt-1 break-words text-[0.9375rem] font-semibold leading-snug text-ink">
            {receipt.customerName}
          </p>
          <p className="break-words text-meta leading-snug text-ink-2">{receipt.customerEmail}</p>
        </div>
        <div className="min-w-0 sm:text-right">
          <p className="text-micro font-semibold uppercase tracking-[0.12em] text-ink-3">Paid with</p>
          <p className="mt-1 text-[0.9375rem] font-semibold leading-snug text-ink">{receipt.paidWith}</p>
          <p className="text-meta leading-snug text-ink-2">Amount charged in Nigerian Naira</p>
        </div>
      </section>

      {/* The charge --------------------------------------------------------- */}
      <section className="px-5 py-5 sm:px-8" aria-labelledby="receipt-charge">
        <h2 id="receipt-charge" className="sr-only">
          Amount charged
        </h2>
        {/* `relative` keeps the `sr-only` heading inside this scroll container;
            without it the heading resolves against the page and stretches it. */}
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Item charged on this receipt</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="pb-2 text-micro font-semibold uppercase tracking-[0.12em] text-ink-3">
                  Description
                </th>
                <th scope="col" className="pb-2 text-right text-micro font-semibold uppercase tracking-[0.12em] text-ink-3">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.description} className="align-top">
                  <td className="py-3 pr-4">
                    <p className="text-[0.9375rem] font-semibold leading-snug text-ink">{item.description}</p>
                    {item.detail ? (
                      <p className="mt-1 max-w-[42ch] break-words text-meta leading-relaxed text-ink-2">
                        {item.detail}
                      </p>
                    ) : null}
                  </td>
                  <td className="w-[1%] whitespace-nowrap py-3 text-right text-[0.9375rem] font-semibold tabular-nums text-ink">
                    {item.amountLabel}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="print-keep border-t border-ink/15">
                <th scope="row" className="py-3 pr-4 text-left text-[0.9375rem] font-semibold text-ink">
                  Total charged
                </th>
                <td className="py-3 text-right text-[1.125rem] font-semibold tabular-nums text-ink">
                  {amountLabel}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Status, and the refund if there is one. -------------------------- */}
        <div className="print-keep mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-cream/40 px-4 py-3 print:bg-white">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-meta font-semibold ${TONE_CLASS[tone]}`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />
            {statusLabel}
          </span>
          {statusNote ? (
            <span className="min-w-0 text-meta leading-relaxed text-ink-2">{statusNote}</span>
          ) : null}
        </div>
      </section>

      {/* Document metadata, then the small print. -------------------------- */}
      <section className="border-t border-line px-5 py-5 sm:px-8">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-4 min-[380px]:grid-cols-2 sm:grid-cols-4">
          <Meta label="Reference" value={receipt.reference} mono />
          <Meta label="Date issued" value={receipt.createdAt} />
          {receipt.service ? <Meta label="Service" value={receiptServiceName(receipt.service)} /> : null}
          <Meta label="Region" value={receipt.region} />
        </dl>
      </section>

      <footer className="border-t border-line px-5 py-5 sm:px-8">
        <p className="max-w-[62ch] text-micro leading-relaxed text-ink-2">{RECEIPT_FOOTER}</p>
        <p className="mt-2 max-w-[62ch] text-micro leading-relaxed text-ink-3">{RECEIPT_SUPPORT_LINE}</p>
        {receipt.generatedAt ? (
          <p className="mt-3 text-micro text-ink-3">
            Generated {receipt.generatedAt} · {receipt.reference}
          </p>
        ) : null}
      </footer>
    </article>
  );
}
