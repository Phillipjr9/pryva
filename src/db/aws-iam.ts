/**
 * Connection pooling for Aurora Postgres provisioned through the Vercel AWS
 * Marketplace integration.
 *
 * That integration authenticates with OIDC federation + RDS IAM. There is no
 * password to put in a connection string: the function presents a Vercel OIDC
 * token, assumes AWS_ROLE_ARN, and mints an auth token that Postgres accepts in
 * place of a password. Tokens are valid for 15 minutes, so `pg` is given a
 * function rather than a string and signs lazily per connection.
 *
 * Both AWS packages are imported dynamically inside the signer factory. A static
 * import here would load `@vercel/functions/oidc` in every environment that
 * touches `src/db/index.ts` -- including the 80-odd test files that run with no
 * database configured at all.
 */
import { Pool, type PoolConfig } from "pg";

import { awsIamConfigured } from "@/lib/database-config";

const TOKEN_TTL_MS = 14 * 60 * 1000; // AWS issues 15-minute tokens; refresh early.

interface IamSettings {
  hostname: string;
  port: number;
  username: string;
  database: string;
  region: string;
  roleArn: string;
}

function readSettings(): IamSettings {
  // awsIamConfigured() has already asserted the four required values.
  const hostname = process.env.PGHOST!.trim();
  const username = process.env.PGUSER!.trim();
  const region = process.env.AWS_REGION!.trim();
  const roleArn = process.env.AWS_ROLE_ARN!.trim();
  const port = Number(process.env.PGPORT?.trim() || 5432);
  return {
    hostname,
    port: Number.isFinite(port) && port > 0 ? port : 5432,
    username,
    database: process.env.PGDATABASE?.trim() || "postgres",
    region,
    roleArn,
  };
}

/**
 * Certificate verification is ON by default.
 *
 * The Vercel and AWS examples pass `ssl: { rejectUnauthorized: false }`, which
 * encrypts the connection but does not verify who is at the other end. This is a
 * database carrying wallet balances, orders and password hashes, so it verifies
 * unless the operator explicitly opts out with PGSSL_NO_VERIFY=1 -- for example
 * when the RDS certificate chain is not in the runtime's trust store. That flag
 * is a deliberate, visible downgrade, not a silent one.
 */
function sslConfig(): PoolConfig["ssl"] {
  const mode = process.env.PGSSLMODE?.trim().toLowerCase();
  if (mode === "disable") return undefined;
  return { rejectUnauthorized: process.env.PGSSL_NO_VERIFY?.trim() !== "1" };
}

let cached: { token: string; expiresAt: number } | null = null;
let signerPromise: Promise<{ getAuthToken: () => Promise<string> }> | null = null;

function loadSigner(settings: IamSettings) {
  signerPromise ??= (async () => {
    const [{ Signer }, { awsCredentialsProvider }] = await Promise.all([
      import("@aws-sdk/rds-signer"),
      import("@vercel/functions/oidc"),
    ]);
    return new Signer({
      hostname: settings.hostname,
      port: settings.port,
      username: settings.username,
      region: settings.region,
      credentials: awsCredentialsProvider({
        roleArn: settings.roleArn,
        clientConfig: { region: settings.region },
      }),
    });
  })();
  return signerPromise;
}

/**
 * Builds the pool. Callers must check `awsIamConfigured()` first; this throws
 * rather than silently connecting to a half-configured database, because a pool
 * that authenticates against the wrong host is indistinguishable from one that
 * works until the first query.
 */
export function createAwsIamPool(): Pool {
  if (!awsIamConfigured()) {
    throw new Error(
      "createAwsIamPool() called without PGHOST, PGUSER, AWS_REGION and AWS_ROLE_ARN all set.",
    );
  }
  const settings = readSettings();

  return new Pool({
    host: settings.hostname,
    port: settings.port,
    user: settings.username,
    database: settings.database,
    ssl: sslConfig(),
    // pg calls this per connection. Reuse the token until it is near expiry so a
    // burst of connections does not each trigger an STS assume-role round trip.
    password: async () => {
      if (cached && cached.expiresAt > Date.now()) return cached.token;
      const signer = await loadSigner(settings);
      const token = await signer.getAuthToken();
      cached = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
      return token;
    },
  });
}
