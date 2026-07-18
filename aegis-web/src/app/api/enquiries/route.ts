import { proxyToBackend } from "../proxy";

export async function POST(req: Request) {
  return proxyToBackend(req, "/public/intake/enquiry");
}
