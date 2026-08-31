import { proxyToBackend } from "../../proxy";

export async function GET(req: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  return proxyToBackend(req, `/public/intake/projects/${encodeURIComponent(params.slug)}`);
}
