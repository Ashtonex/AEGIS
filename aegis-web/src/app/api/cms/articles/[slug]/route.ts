import { proxyToBackend } from "../../../proxy";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return proxyToBackend(req, `/website/articles/${encodeURIComponent(slug)}`);
}
