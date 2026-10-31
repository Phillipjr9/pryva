import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  backupFileName,
  expiredBackups,
  insertionOrder,
  sha256Hex,
  verifyManifest,
  type BackupManifest,
} from "@/lib/backup";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const backupScript = readFileSync("scripts/backup-db.mjs", "utf8");
const restoreScript = readFileSync("scripts/restore-db.mjs", "utf8");

describe("backup file names", () => {
  it("sort chronologically and are unambiguous", () => {
    const early = backupFileName(new Date("2026-10-30T03:15:00Z"));
    const late = backupFileName(new Date("2026-10-30T03:15:01Z"));
    expect(early).toBe("pryva-backup-20261030-031500.ndjson.gz");
    expect(early < late).toBe(true);
  });

  it("uses UTC, so a backup taken at a local midnight is still ordered", () => {
    expect(backupFileName(new Date("2026-01-01T00:00:00Z"))).toBe("pryva-backup-20260101-000000.ndjson.gz");
    expect(backupFileName(new Date("2026-12-31T23:59:59Z"))).toBe("pryva-backup-20261231-235959.ndjson.gz");
  });
});

describe("retention", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const files = [
    { name: "pryva-backup-20261030-030000.ndjson.gz", createdAt: new Date("2026-10-30T03:00:00Z") },
    { name: "pryva-backup-20261029-030000.ndjson.gz", createdAt: new Date("2026-10-29T03:00:00Z") },
    { name: "pryva-backup-20261001-030000.ndjson.gz", createdAt: new Date("2026-10-01T03:00:00Z") },
  ];

  it("expires only what is older than the window", () => {
    expect(expiredBackups(files, 14, now)).toEqual(["pryva-backup-20261001-030000.ndjson.gz"]);
    expect(expiredBackups(files, 30, now)).toEqual([]);
  });

  it("never expires the whole set because of a bad window", () => {
    expect(expiredBackups(files, 0, now)).toEqual([]);
    expect(expiredBackups(files, Number.NaN, now)).toEqual([]);
    expect(expiredBackups(files, -5, now)).toEqual([]);
  });

  it("returns them oldest first, so a partial failure leaves the newest", () => {
    const many = [
      { name: "b", createdAt: new Date("2026-10-02T00:00:00Z") },
      { name: "a", createdAt: new Date("2026-10-01T00:00:00Z") },
    ];
    expect(expiredBackups(many, 1, now)).toEqual(["a", "b"]);
  });
});

describe("restore order", () => {
  it("puts every parent before its child", () => {
    const order = insertionOrder(
      ["orders", "users", "wallet_transactions"],
      [
        ["orders", "users"],
        ["wallet_transactions", "users"],
        ["wallet_transactions", "orders"],
      ],
    );
    expect(order[0]).toBe("users");
    expect(order.indexOf("orders")).toBeLessThan(order.indexOf("wallet_transactions"));
  });

  it("handles a chain three deep", () => {
    const order = insertionOrder(["c", "b", "a"], [["b", "a"], ["c", "b"]]);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("is deterministic for unrelated tables", () => {
    expect(insertionOrder(["z", "a", "m"], [])).toEqual(["a", "m", "z"]);
  });

  it("keeps a table caught in a cycle instead of dropping it", () => {
    // a <-> b is unresolvable, and c depends on a, so nothing can be ordered.
    // Dropping a table here would restore a database that looks complete.
    const order = insertionOrder(["c", "a", "b"], [["a", "b"], ["b", "a"], ["c", "a"]]);
    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(["a", "b", "c"]));
  });

  it("still orders everything outside the cycle", () => {
    const order = insertionOrder(
      ["a", "b", "orders", "users"],
      [["a", "b"], ["b", "a"], ["orders", "users"]],
    );
    expect(order.indexOf("users")).toBeLessThan(order.indexOf("orders"));
    expect(new Set(order)).toEqual(new Set(["a", "b", "orders", "users"]));
  });

  it("ignores edges naming tables that are not in the dump", () => {
    const order = insertionOrder(["a"], [["a", "gone"], ["gone", "a"], ["a", "a"]]);
    expect(order).toEqual(["a"]);
  });
});

describe("manifest verification", () => {
  const rows = JSON.stringify([{ id: 1 }, { id: 2 }]);
  const manifest: BackupManifest = {
    version: 1,
    createdAt: "2026-10-30T03:15:00.000Z",
    label: "manual",
    migrations: ["0000_base_schema.sql"],
    tables: [{ name: "users", rows: 2, sha256: sha256Hex(rows) }],
    foreignKeys: [],
  };

  it("accepts an archive that matches its checksums", () => {
    const result = verifyManifest(manifest, { users: rows });
    expect(result.ok).toBe(true);
    expect(result.tables).toBe(1);
    expect(result.rows).toBe(2);
  });

  it("catches a truncated or altered table", () => {
    const result = verifyManifest(manifest, { users: JSON.stringify([{ id: 1 }]) });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/checksum/);
  });

  it("catches a table that is listed but missing", () => {
    const result = verifyManifest(manifest, {});
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/missing from the archive/);
  });

  it("catches data the manifest does not know about", () => {
    const result = verifyManifest(manifest, { users: rows, extra: "[]" });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/not in the manifest/);
  });

  it("refuses a file that is not a backup at all", () => {
    expect(verifyManifest(null, { users: rows }).ok).toBe(false);
    expect(verifyManifest({ version: 99, tables: [] }, {}).problems.join(" ")).toMatch(/version/);
    expect(verifyManifest({ version: 1, tables: [] }, {}).problems.join(" ")).toMatch(/no tables/);
  });
});

describe("the scripts refuse the ways a restore goes wrong", () => {
  it("ships runnable commands", () => {
    expect(packageJson.scripts["db:backup"]).toContain("backup-db.mjs");
    expect(packageJson.scripts["db:restore"]).toContain("restore-db.mjs");
    expect(packageJson.scripts["db:verify-backup"]).toContain("--verify");
  });

  it("will not take a backup without a database to take it from", () => {
    expect(backupScript).toMatch(/Refusing to guess/);
    expect(backupScript).toContain("DATABASE_URL");
  });

  it("verifies a backup before pruning anything older", () => {
    const verifyAt = backupScript.indexOf("await verify(file)");
    const pruneAt = backupScript.indexOf("expiredBackups(");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(pruneAt).toBeGreaterThan(verifyAt);
  });

  it("requires an explicit flag, and refuses the live database", () => {
    expect(restoreScript).toContain("--confirm-restore");
    expect(restoreScript).toContain("--allow-overwrite");
    expect(restoreScript).toMatch(/same database DATABASE_URL points at/);
  });

  it("verifies checksums before writing a single row", () => {
    const verifyAt = restoreScript.indexOf("verifyManifest(");
    const insertAt = restoreScript.indexOf("INSERT INTO");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(verifyAt);
  });

  it("wraps the restore in one transaction", () => {
    expect(restoreScript).toContain("BEGIN");
    expect(restoreScript).toContain("ROLLBACK");
    expect(restoreScript).toContain("COMMIT");
  });
});
