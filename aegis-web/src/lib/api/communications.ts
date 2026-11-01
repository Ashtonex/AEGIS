import type { ApiResponse } from "@/types/api";
import { fetchApi } from "./core";

// Staff communications: one message to many people over in-app, email,
// Teams and WhatsApp (imperium-api routers/communications.py).

export type CommunicationChannel = "in_app" | "email" | "teams" | "whatsapp";

export interface SendCommunicationPayload {
  recipient_user_ids: string[];
  subject: string;
  body: string;
  channels: CommunicationChannel[];
  action_url?: string;
  whatsapp_content_sid?: string;
  whatsapp_content_variables?: Record<string, string>;
}

export interface SendCommunicationResult {
  dispatch_id: string;
  recipients: number;
  channels: CommunicationChannel[];
  deliveries: Record<string, number>;
  missing_recipients: string[];
}

export async function sendCommunication(payload: SendCommunicationPayload): Promise<ApiResponse<SendCommunicationResult>> {
  return fetchApi<ApiResponse<SendCommunicationResult>>("/api/v1/communications/send", {
    method: "POST",
    body: JSON.stringify(payload),
    allowFallback: false,
  });
}

export async function getCommunications(limit = 50): Promise<ApiResponse<any[]>> {
  return fetchApi<ApiResponse<any[]>>(`/api/v1/communications?limit=${limit}`, { cache: "no-store" });
}

export async function getCommunication(dispatchId: string): Promise<ApiResponse<any>> {
  return fetchApi<ApiResponse<any>>(`/api/v1/communications/${encodeURIComponent(dispatchId)}`, { cache: "no-store" });
}
