import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { createAppSession, getAppSessionUserId, revokeAppSession, setActiveAccount } from "./db";

export const PKCE_COOKIE = "xbv_pkce";
export const STATE_COOKIE = "xbv_state";
export const APP_SESSION_COOKIE = "xbv_session";
const APP_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

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

export async function createAppSessionCookie(userId: string) {
  const token = createAppSession(userId);
  const store = await cookies();
  store.set(APP_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: APP_SESSION_MAX_AGE_SECONDS,
    path: "/"
  });
}

export async function getAppSessionUser() {
  const store = await cookies();
  return getAppSessionUserId(store.get(APP_SESSION_COOKIE)?.value ?? null);
}

export async function setActiveAccountForSession(userId: string) {
  const store = await cookies();
  setActiveAccount(userId, store.get(APP_SESSION_COOKIE)?.value ?? null);
}

export async function clearAppSessionCookie() {
  const store = await cookies();
  const token = store.get(APP_SESSION_COOKIE)?.value ?? null;
  revokeAppSession(token);
  store.delete(APP_SESSION_COOKIE);
}

export async function hasAppSession() {
  return Boolean(await getAppSessionUser());
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      return false;
    }

    const requestUrl = new URL(request.url);
    if (parsedOrigin.origin === requestUrl.origin) {
      return true;
    }

    const host = request.headers.get("host");
    if (host) {
      try {
        return parsedOrigin.origin === new URL(`${requestUrl.protocol}//${host}`).origin;
      } catch {
        return false;
      }
    }
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) {
    return fetchSite === "same-origin" || fetchSite === "none";
  }

  const referer = request.headers.get("referer");
  if (!referer) {
    return false;
  }
  try {
    return new URL(referer).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
