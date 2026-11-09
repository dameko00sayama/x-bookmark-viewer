import { NextRequest, NextResponse } from "next/server";
import {
  getApiChargeLimitUsd,
  getEstimatedApiUsageUsd,
  resetApiUsageTracking,
  setApiChargeLimitUsd
} from "@/lib/db";

const DEFAULT_CHARGE_USD = 5;

export async function GET() {
  return NextResponse.json({
    apiChargeUsd: getApiChargeLimitUsd(),
    estimatedApiUsageUsd: getEstimatedApiUsageUsd(),
    defaultApiChargeUsd: DEFAULT_CHARGE_USD
  });
}

export async function POST(request: NextRequest) {
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
      if (!Number.isFinite(nextValue) || nextValue <= 0) {
        return NextResponse.json({ error: "INVALID_API_CHARGE_USD" }, { status: 400 });
      }
      setApiChargeLimitUsd(nextValue);
      return NextResponse.json({
        apiChargeUsd: getApiChargeLimitUsd(),
        estimatedApiUsageUsd: getEstimatedApiUsageUsd()
      });
    }

    return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "SETTINGS_UPDATE_FAILED" }, { status: 500 });
  }
}
