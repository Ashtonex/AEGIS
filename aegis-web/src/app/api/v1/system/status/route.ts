import { NextResponse } from "next/server";
import { resolveBackendOrigin } from "@/lib/backend-url";

export async function GET() {
  const startedAt = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${resolveBackendOrigin()}/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latency_ms = Date.now() - startedAt;

    if (!res.ok) {
      return NextResponse.json({
        status: "degraded",
        services: { aegis_core: "degraded" },
        metrics: { latency_ms },
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      status: "online",
      services: { aegis_core: "online" },
      metrics: { latency_ms },
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      status: "offline",
      services: { aegis_core: "offline" },
      metrics: { latency_ms: Date.now() - startedAt },
      timestamp: new Date().toISOString(),
    });
  }
}
