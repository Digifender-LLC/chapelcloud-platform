import type { SessionUser } from "./auth/sessions";

export type AppEnv = {
  Bindings: Env;
  Variables: { session: SessionUser };
};

export type Role = "owner" | "admin" | "member";
export const ROLES: readonly Role[] = ["owner", "admin", "member"];

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  // Deliberately loose: the invitation flow proves the address is reachable.
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
