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
    return NextResponse.redirect(appUrl("/auth?error=oauth_state", request.url));
  }

  try {
    const token = await exchangeCodeForToken(code, storedState.verifier);
    const me = await fetchMe(token.access_token);

    saveAuth({
      userId: me.id,
      username: me.username,
      name: me.name,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: Date.now() + (token.expires_in ?? 7200) * 1000
    });

    return NextResponse.redirect(appUrl("/auth", request.url));
  } catch {
    console.error("OAuth callback failed");
    return NextResponse.redirect(appUrl("/auth?error=oauth_failed", request.url));
  }
}
