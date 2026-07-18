import { NextResponse } from "next/server";
import { resolveBackendOrigin } from "@/lib/backend-url";

const BASE_BACKEND_URL = `${resolveBackendOrigin()}/api/v1`;

// Proxy helper
export async function proxyToBackend(req: Request, endpoint: string) {
  const url = new URL(req.url);
  const backendUrl = `${BASE_BACKEND_URL}${endpoint}${url.search}`;
  
  try {
    const headers = new Headers(req.headers);
    // Remove host header to avoid issues with backend routing
    headers.delete("host");
    
    const init: RequestInit = {
      method: req.method,
      headers,
    };
    
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = await req.text();
    }
    
    const response = await fetch(backendUrl, init);
    const data = await response.json().catch(() => ({}));
    
    return NextResponse.json(data, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error: any) {
    console.error("API Proxy Error:", error);
    return NextResponse.json(
      { success: false, error: { code: "PROXY_ERROR", message: "Failed to connect to backend service" } },
      { status: 502 }
    );
  }
}

