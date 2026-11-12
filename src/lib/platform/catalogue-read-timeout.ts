import "server-only";

/** A bounded wait for a read-only catalogue operation, never a paid action. */
export class CatalogueReadTimeout extends Error {
  constructor() {
    super("Catalogue read timed out");
    this.name = "CatalogueReadTimeout";
  }
}

/**
 * Stops this caller waiting, without cancelling shared refreshes needed by other
 * requests. The underlying provider operations retain their own deadlines.
 */
export async function withCatalogueReadTimeout<T>(read: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new CatalogueReadTimeout()), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
