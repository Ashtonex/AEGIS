const DEFAULT_BACKEND_URL = "http://localhost:8000";

export function resolveBackendOrigin(): string {
  const rawUrl =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    DEFAULT_BACKEND_URL;
  const trimmedUrl = rawUrl.trim().replace(/\/+$/, "").replace(/\/api\/v1$/, "");

  if (/^https?:\/\//i.test(trimmedUrl)) {
    return trimmedUrl;
  }

  const protocol = trimmedUrl.endsWith(".onrender.com") ? "https" : "http";
  return `${protocol}://${trimmedUrl}`;
}
