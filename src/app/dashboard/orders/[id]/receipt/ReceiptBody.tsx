import { formatNaira } from "@/lib/catalog";
import { receiptStatusLabel, RECEIPT_FOOTER } from "@/lib/receipt";

/**
 * One order, as a document.
 *
 * Presentational on purpose: the page fetches and authorises, this renders, and a
 * test can print it without a database. Nothing here reads `provider` -- the field
 * exists on the row and must never reach a customer, least of all on paper.
 */
export interface ReceiptData {
  reference: string;
  productName: string;
  planLabel: string;
  region: string;
  duration: string;
  amount: number;
  status: string;
  createdAt: string;
  /** e.g. "Wallet balance" — how the customer paid. */
  paidWith: string;
  customerName: string;
  customerEmail: string;
  refundedAt?: string | null;
}

export function ReceiptBody({ receipt }: { receipt: ReceiptData }) {
  const rows: Array<[string, string]> = [
    ["Reference", receipt.reference],
    ["Date", receipt.createdAt],
    ["Product", receipt.productName],
    ["Plan", receipt.planLabel],
    ["Region", receipt.region],
    ["Validity", receipt.duration],
    ["Paid with", receipt.paidWith],
    ["Status", receiptStatusLabel(receipt.status)],
  ];
  if (receipt.refundedAt) rows.push(["Refunded", receipt.refundedAt]);

  return (
    <article className="mx-auto w-full max-w-[720px] rounded-2xl border border-line bg-white p-6 sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="text-[1.1rem] font-semibold tracking-tight text-ink">Pryva</p>
          <p className="mt-0.5 text-meta text-ink-3">pryva.ng</p>
        </div>
        <div className="text-right">
          <p className="text-micro font-semibold uppercase tracking-[0.14em] text-ink-3">Receipt</p>
          <p className="mt-1 font-mono text-[0.9rem] font-semibold text-ink">{receipt.reference}</p>
        </div>
      </header>

      <section className="mt-5 grid gap-1 text-[0.86rem] text-ink-2">
        <p>
          <span className="text-ink-3">Customer:</span> {receipt.customerName}
        </p>
        <p>
          <span className="text-ink-3">Account:</span> {receipt.customerEmail}
        </p>
      </section>

      <div className="mt-6 overflow-x-auto">
      <table className="w-full border-collapse text-[0.86rem]">
        <caption className="sr-only">Order details</caption>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-line/70 last:border-0">
              <th scope="row" className="w-1/3 py-2.5 pr-4 text-left font-medium text-ink-3">
                {label}
              </th>
              <td className="py-2.5 text-ink">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="mt-6 flex items-baseline justify-between border-t border-line pt-4">
        <p className="text-[0.9rem] font-semibold text-ink">Total charged</p>
        <p className="text-[1.35rem] font-semibold tabular-nums text-ink">{formatNaira(receipt.amount)}</p>
      </div>

      <p className="mt-6 text-micro leading-relaxed text-ink-3">{RECEIPT_FOOTER}</p>
    </article>
  );
}
