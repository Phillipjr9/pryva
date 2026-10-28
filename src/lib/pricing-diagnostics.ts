/**
 * Developer diagnostics for the generated price sheet.
 *
 * These messages explain how to fix a *build* problem (a plan whose cost was
 * never added to the sheet), so they name internal files. They are thrown at
 * module load and land in server logs or the dev overlay — production error
 * boundaries render a generic message, never this text — which is why this
 * module sits outside the customer-facing copy scanned by
 * `src/test/supplier-secrecy.test.ts`.
 */

export const COST_SHEET_PATH = "data/cost-sheet.json";

/** Error for a plan missing from `prices.generated.ts`. */
export function missingPriceError(subject: string): Error {
  return new Error(
    `No generated price for ${subject}. Add its cost to ` +
      `${COST_SHEET_PATH} and run \`npm run pricing:build\`.`,
  );
}
