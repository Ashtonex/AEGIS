import { NextResponse } from "next/server";
import { proxyToBackend } from "../../proxy";

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const hasTrailingSlash = req.url.split("?")[0].endsWith("/");
  const endpoint = "/" + path.join("/") + (hasTrailingSlash ? "/" : "");
  return proxyToBackend(req, endpoint);
}

export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const hasTrailingSlash = req.url.split("?")[0].endsWith("/");
  const endpoint = "/" + path.join("/") + (hasTrailingSlash ? "/" : "");
  return proxyToBackend(req, endpoint);
}

export async function PUT(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const hasTrailingSlash = req.url.split("?")[0].endsWith("/");
  const endpoint = "/" + path.join("/") + (hasTrailingSlash ? "/" : "");
  return proxyToBackend(req, endpoint);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const hasTrailingSlash = req.url.split("?")[0].endsWith("/");
  const endpoint = "/" + path.join("/") + (hasTrailingSlash ? "/" : "");
  return proxyToBackend(req, endpoint);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const hasTrailingSlash = req.url.split("?")[0].endsWith("/");
  const endpoint = "/" + path.join("/") + (hasTrailingSlash ? "/" : "");
  return proxyToBackend(req, endpoint);
}
