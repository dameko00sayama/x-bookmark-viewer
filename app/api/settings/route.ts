import { NextRequest, NextResponse } from "next/server";
import {
  getApiChargeLimitUsd,
  getEstimatedApiUsageUsd,
  MAX_API_CHARGE_LIMIT_USD,
  resetApiUsageTracking,
  setApiChargeLimitUsd
} from "@/lib/db";
import { getAppSessionUser, isSameOriginRequest } from "@/lib/session";

const DEFAULT_CHARGE_USD = 5;

export async function GET(request: Request) {
  if (!(await getAppSessionUser()) || !isSameOriginRequest(request)) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  return NextResponse.json({
    apiChargeUsd: getApiChargeLimitUsd(),
    estimatedApiUsageUsd: getEstimatedApiUsageUsd(),
    defaultApiChargeUsd: DEFAULT_CHARGE_USD,
    maxApiChargeUsd: MAX_API_CHARGE_LIMIT_USD
  });
}

export async function POST(request: NextRequest) {
  if (!(await getAppSessionUser()) || !isSameOriginRequest(request)) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      apiChargeUsd?: number;
    };

    if (body.action === "reset") {
      setApiChargeLimitUsd(DEFAULT_CHARGE_USD);
      resetApiUsageTracking();
      return NextResponse.json({
        apiChargeUsd: getApiChargeLimitUsd(),
        estimatedApiUsageUsd: getEstimatedApiUsageUsd()
      });
    }

    if (body.action === "set-limit" && typeof body.apiChargeUsd === "number") {
      const nextValue = Number(body.apiChargeUsd);
      if (!Number.isFinite(nextValue) || nextValue <= 0 || nextValue > MAX_API_CHARGE_LIMIT_USD) {
        return NextResponse.json({ error: "INVALID_API_CHARGE_USD" }, { status: 400 });
      }
      setApiChargeLimitUsd(nextValue);
      return NextResponse.json({
        apiChargeUsd: getApiChargeLimitUsd(),
        estimatedApiUsageUsd: getEstimatedApiUsageUsd()
      });
    }

    return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SETTINGS_UPDATE_FAILED";
    const status = message === "INVALID_API_CHARGE_USD" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
