import { NextResponse } from "next/server";
import { resolveBackendOrigin } from "@/lib/backend-url";

const BASE_BACKEND_URL = `${resolveBackendOrigin()}/api/v1`;

async function readRequestBody(req: Request): Promise<Buffer | undefined> {
  if (!req.body) {
    return undefined;
  }

  const reader = req.body.getReader();
  const chunks: Buffer[] = [];

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      chunks.push(Buffer.from(value));
    }
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
}

// Proxy helper
export async function proxyToBackend(req: Request, endpoint: string) {
  const url = new URL(req.url);
  const backendUrl = `${BASE_BACKEND_URL}${endpoint}${url.search}`;
  
  try {
    const headers = new Headers(req.headers);
    // Remove host header to avoid issues with backend routing
    headers.delete("host");
    headers.delete("content-length");
    headers.delete("content-encoding");
    
    const init: RequestInit = {
      method: req.method,
      headers,
    };
    
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = (await readRequestBody(req)) as unknown as BodyInit;
    }
    
    const response = await fetch(backendUrl, init);
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json") && !contentType.includes("text/")) {
      // Binary/file response (PDF, xlsx, images, etc.) - relay bytes as-is,
      // do not attempt to JSON-parse them.
      const passthroughHeaders = new Headers(response.headers);
      // fetch() already decompresses the body, so the upstream content-length/
      // content-encoding no longer describe what we're about to send.
      passthroughHeaders.delete("content-encoding");
      passthroughHeaders.delete("content-length");

      return new NextResponse(response.body, {
        status: response.status,
        headers: passthroughHeaders,
      });
    }

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

