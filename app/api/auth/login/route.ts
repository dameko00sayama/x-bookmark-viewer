import { NextResponse } from "next/server";
import { saveOAuthState } from "@/lib/db";
import { buildAuthorizationUrl, createCodeChallenge } from "@/lib/x-api";
import { randomBase64Url } from "@/lib/session";

export async function GET() {
  try {
    const state = randomBase64Url(24);
    const verifier = randomBase64Url(64);
    const url = buildAuthorizationUrl(state, createCodeChallenge(verifier));

    saveOAuthState(state, verifier);

    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(new URL("/?error=missing_config", process.env.APP_BASE_URL ?? "http://localhost:8080"));
  }
}
