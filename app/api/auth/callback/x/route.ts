import { NextRequest, NextResponse } from "next/server";
import { consumeOAuthState, saveAuth } from "@/lib/db";
import { exchangeCodeForToken, fetchMe } from "@/lib/x-api";

function appUrl(path: string, requestUrl: string) {
  return new URL(path, process.env.APP_BASE_URL ?? requestUrl);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = state ? consumeOAuthState(state) : null;

  if (!code || !state || !storedState) {
    return NextResponse.redirect(appUrl("/?error=oauth_state", request.url));
  }

  try {
    const token = await exchangeCodeForToken(code, storedState.verifier);
    const me = await fetchMe(token.access_token);

    saveAuth({
      userId: me.id,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: Date.now() + (token.expires_in ?? 7200) * 1000
    });

    return NextResponse.redirect(appUrl("/", request.url));
  } catch (error) {
    console.error("OAuth callback failed:", error);
    const reason = error instanceof Error ? error.message : String(error);
    return NextResponse.redirect(appUrl(`/?error=oauth_failed&reason=${encodeURIComponent(reason)}`, request.url));
  }
}
