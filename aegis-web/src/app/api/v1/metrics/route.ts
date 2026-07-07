import { NextResponse } from "next/server";

export async function GET() {
  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 600));

  return NextResponse.json({
    status: "success",
    data: {
      projectsCompleted: 184,
      fleetAssets: 78,
      contractValue: 340,
      ltiFrequency: 0,
      activeSites: 12,
      lastUpdated: new Date().toISOString(),
    },
  });
}
