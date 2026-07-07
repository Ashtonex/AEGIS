import { proxyToBackend } from "../../../proxy";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return proxyToBackend(req, `/tenders/${params.id}/interest`);
}
