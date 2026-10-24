import { NextResponse } from "next/server";
import { resolveBackendOrigin } from "@/lib/backend-url";

const BASE_BACKEND_URL = `${resolveBackendOrigin()}/api/v1`;

// The backend restarts on every deploy; ride out a short gap instead of failing.
const RETRY_DELAYS_MS = [1000, 3000, 6000];

function connectionRefused(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return cause?.code === "ECONNREFUSED";
}

async function fetchWithRetry(url: string, init: RequestInit, replayable: boolean): Promise<Response> {
  const idempotent = init.method === "GET" || init.method === "HEAD";
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      // A refused connection never reached the API, so even a write is safe to
      // resend. Other failures may have, so only idempotent requests retry them.
      const retryable = replayable && (idempotent || connectionRefused(error));
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
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
    
    // A streamed (e.g. multipart upload) body can only be sent once.
    let replayable = true;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const contentType = headers.get("content-type") || "";
      const isTextBody =
        contentType.includes("application/json") ||
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.startsWith("text/");

      if (isTextBody) {
        init.body = await req.text();
      } else {
        init.body = req.body as unknown as BodyInit;
        (init as RequestInit & { duplex: "half" }).duplex = "half";
        replayable = false;
      }
    }

    const response = await fetchWithRetry(backendUrl, init, replayable);
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
      {
        success: false,
        error: { code: "BACKEND_UNAVAILABLE", message: "AEGIS is restarting - please try again in a moment." },
      },
      { status: 503, headers: { "Retry-After": "10" } }
    );
  }
}

