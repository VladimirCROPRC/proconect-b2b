export const accountRoles = ["Admin", "Manager", "Coordonator", "Tehnician"] as const;
export type AppRole = typeof accountRoles[number];

export function normalizeAccountRoles(value: unknown): AppRole[] | null {
  if (!Array.isArray(value) || !value.length || value.length > accountRoles.length) return null;
  if (value.some(role => !accountRoles.includes(role as AppRole))) return null;
  return accountRoles.filter(role => value.includes(role));
}

export function accountHasRole(account: { role: string; roles?: readonly string[] }, role: AppRole) {
  return (account.roles ?? [account.role]).includes(role);
}
