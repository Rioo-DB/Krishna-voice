const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

// Usernames (sign-in names without an @) are accounts at this email domain. Server only:
// it is never shown or sent to the browser (sign-in runs in /auth/signin)
const USERNAME_DOMAIN = process.env.USERNAME_DOMAIN?.trim().toLowerCase() || "";
export const usernamesEnabled = Boolean(USERNAME_DOMAIN);

/** What the sign-in box holds, as the email Supabase knows: "demo" becomes demo@<domain>. */
export const toEmail = (login: string) => {
  const s = login.trim().toLowerCase();
  return s.includes("@") || !USERNAME_DOMAIN ? s : `${s}@${USERNAME_DOMAIN}`;
};

/** How to show an account: its username when it is one, otherwise its email. */
export const displayName = (email: string | undefined) => {
  const e = (email ?? "").toLowerCase();
  return USERNAME_DOMAIN && e.endsWith(`@${USERNAME_DOMAIN}`) ? e.slice(0, -USERNAME_DOMAIN.length - 1) : e;
};

/**
 * Supabase holds accounts (email and password login), transcripts and minutes. Without it
 * (local dev) there is no login, nothing is saved and there is no quota.
 */
export const dbConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
