"use client";

import { useState } from "react";
import { Bot, Loader2, Send, User } from "lucide-react";
import { askFinanceAssistant } from "@/lib/api";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { name: string; arguments: Record<string, any> }[];
  isError?: boolean;
};

const TOOL_LABELS: Record<string, string> = {
  get_trial_balance: "Trial Balance",
  get_project_ledger: "Project Ledger",
  get_project_gl_reconciliation: "GL Reconciliation",
  list_ccb_findings: "CCB Findings",
  get_vat_net_position: "VAT Net Position",
  get_upcoming_tax_deadlines: "Tax Calendar",
  get_cash_forecast: "Cash Forecast",
  get_cash_runway: "Cash Runway",
  get_historical_reconciliation: "Historical Reconciliation",
  get_company_budget_variance: "Company Budget Variance",
  get_department_budget_variance: "Department Budget Variance",
};

export function FinanceAssistantPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || sending) return;

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setSending(true);

    try {
      const res = await askFinanceAssistant(question, history);
      const data = res.data || {};
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer || "I wasn't able to produce an answer for that.",
          toolCalls: data.tool_calls || [],
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: err?.message || "Something went wrong asking the assistant.", isError: true },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-[70vh] bg-ink-light border border-ink-mid rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-ink-mid bg-ink/30 flex items-start gap-2">
        <Bot className="h-4 w-4 text-signal mt-0.5" />
        <div>
          <h2 className="font-mono text-sm uppercase tracking-widest text-signal">AI Financial Control Assistant</h2>
          <p className="text-xs text-slate-light mt-0.5">
            Read-only. It can look up and explain finance data already in the system, but it cannot approve, post, settle, or delete anything - ask on the relevant screen for that.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 p-4">
        {messages.length === 0 && (
          <p className="text-xs text-slate-light">
            Ask something like &ldquo;what&rsquo;s our VAT position this quarter&rdquo; or &ldquo;how is project X&rsquo;s GL looking against forecast&rdquo;.
          </p>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
            <div
              className={`max-w-[85%] p-3 border text-xs leading-relaxed flex items-start gap-2 ${
                msg.isError
                  ? "bg-red-950/20 border-red-500/30 text-red-300"
                  : msg.role === "user"
                  ? "bg-signal/5 border-signal/30 text-paper"
                  : "bg-ink border-ink-mid text-paper"
              }`}
            >
              {msg.role === "assistant" ? <Bot className="h-3.5 w-3.5 text-signal mt-0.5 shrink-0" /> : <User className="h-3.5 w-3.5 text-slate mt-0.5 shrink-0" />}
              <p className="font-sans whitespace-pre-wrap">{msg.content}</p>
            </div>
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <span className="text-[9px] font-mono uppercase text-slate-light">Consulted:</span>
                {msg.toolCalls.map((tc, tcIdx) => (
                  <span key={tcIdx} className="text-[9px] font-mono px-1.5 py-0.5 border border-ink-mid text-slate-light rounded-sm">
                    {TOOL_LABELS[tc.name] || tc.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-slate-light">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking that up...
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-ink-mid p-3 shrink-0">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Ask about the GL, VAT, cash position, CCB findings, budgets..."
            rows={2}
            className="w-full bg-ink border border-ink-mid p-3 text-xs text-paper focus:border-signal focus:outline-none font-sans resize-none pr-12 custom-scrollbar"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="absolute right-3 bottom-3 w-8 h-8 bg-signal hover:bg-signal/80 disabled:bg-ink-mid/30 disabled:text-slate text-ink flex items-center justify-center transition-all"
            title="Ask"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin text-slate" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
      </form>
    </div>
  );
}
