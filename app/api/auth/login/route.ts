import { NextRequest, NextResponse } from "next/server";
import { saveOAuthState } from "@/lib/db";
import { buildAuthorizationUrl, createCodeChallenge } from "@/lib/x-api";
import { PKCE_COOKIE, randomBase64Url, setAuthCookie, STATE_COOKIE } from "@/lib/session";

export async function GET(request: NextRequest) {
  try {
    const state = randomBase64Url(24);
    const verifier = randomBase64Url(64);
    const origin = request.nextUrl.origin;
    const url = buildAuthorizationUrl(state, createCodeChallenge(verifier), origin);

    saveOAuthState(state, verifier);
    await setAuthCookie(STATE_COOKIE, state);
    await setAuthCookie(PKCE_COOKIE, verifier);

    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(new URL("/auth?error=missing_config", process.env.APP_BASE_URL ?? "http://localhost:8181"));
  }
}
