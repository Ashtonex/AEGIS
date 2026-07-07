import { NextResponse } from "next/server";

export async function GET() {
  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 300));

  return NextResponse.json({
    status: "online",
    services: {
      aegis_core: "online",
      client_portal: "online",
      partner_network: "online",
      database: "online",
    },
    metrics: {
      latency_ms: Math.floor(Math.random() * 20) + 10, // Random latency between 10-30ms
      active_sessions: 42,
    },
    timestamp: new Date().toISOString(),
  });
}
