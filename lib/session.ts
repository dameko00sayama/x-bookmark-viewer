import { cookies } from "next/headers";
import { randomBytes } from "crypto";

export const PKCE_COOKIE = "xbv_pkce";
export const STATE_COOKIE = "xbv_state";

export function randomBase64Url(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export async function setAuthCookie(name: string, value: string) {
  const store = await cookies();
  store.set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/"
  });
}

export async function getAuthCookie(name: string) {
  const store = await cookies();
  return store.get(name)?.value ?? null;
}

export async function clearAuthCookie(name: string) {
  const store = await cookies();
  store.delete(name);
}
