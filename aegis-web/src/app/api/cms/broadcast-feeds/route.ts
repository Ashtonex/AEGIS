import { proxyToBackend } from "../../proxy";

export async function GET(req: Request) {
  return proxyToBackend(req, "/public/intake/broadcast-feeds");
}
