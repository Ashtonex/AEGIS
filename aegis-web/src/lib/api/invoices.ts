import { resolveApiUrl } from "./core";

export async function generateSNCInvoicePdf(payload: Record<string, unknown>, token?: string): Promise<Blob> {
  const url = resolveApiUrl("/api/v1/documents/invoices/generate-pdf");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to generate invoice PDF (${res.status}): ${errorText}`);
  }

  return res.blob();
}

export async function reserveInvoiceNumber(token?: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(resolveApiUrl("/api/v1/documents/invoices/next-number"), {
    method: "POST",
    headers,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to reserve invoice number (${res.status}): ${errorText}`);
  }

  const body = await res.json();
  return String(body?.data?.invoice_number);
}
