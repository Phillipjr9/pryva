/**
 * User shapes that are safe to hand to client components.
 *
 * Deliberately separate from `@/lib/auth` so a client bundle never pulls in the
 * database client or the hashing helpers just to name a type.
 */
export type SafeUser = {
  id: string;
  name: string;
  email: string;
  walletBalance: number;
  createdAt: Date;
};
