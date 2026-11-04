"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, CheckCircle2, ChevronRight, Search, X } from "lucide-react";
import { RBACGuard } from "@/components/auth/RBACGuard";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import {
  GUIDE_ACCOUNT_RANGES,
  GUIDE_FLOWS,
  GUIDE_GLOSSARY,
  GUIDE_HUBS,
  GUIDE_MONTH_END,
  GUIDE_PRINCIPLES,
  type GuidePage,
} from "./guideContent";

const TOC: { id: string; label: string }[] = [
  { id: "basics", label: "The basics" },
  { id: "flows", label: "How money moves" },
  ...GUIDE_HUBS.map((hub) => ({ id: hub.id, label: hub.name })),
  { id: "month-end", label: "Month-end checklist" },
  { id: "accounts", label: "Chart of accounts" },
  { id: "glossary", label: "Glossary" },
];

function pageMatches(page: GuidePage, q: string) {
  return [page.name, page.purpose, page.source ?? "", ...page.youDo].some((text) => text.toLowerCase().includes(q));
}

function SectionHeading({ eyebrow, title, summary }: { eyebrow: string; title: string; summary?: string }) {
  return (
    <div className="mb-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-slate">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold text-paper">{title}</h2>
      {summary && <p className="mt-1 max-w-3xl text-sm text-slate-light">{summary}</p>}
    </div>
  );
}

function PageCard({ page }: { page: GuidePage }) {
  return (
    <article className="flex flex-col rounded-sm border border-ink-mid bg-ink-light p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-paper">{page.name}</h3>
        <Link
          href={page.href}
          className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-signal hover:text-paper"
        >
          Open <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <p className="mt-1 text-sm text-slate-light">{page.purpose}</p>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-slate">What you do here</p>
      <ul className="mt-1 space-y-1">
        {page.youDo.map((item) => (
          <li key={item} className="flex gap-2 text-sm text-paper">
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {page.source && (
        <p className="mt-3 border-t border-ink-mid pt-3 text-xs leading-relaxed text-slate-light">
          <span className="font-semibold text-paper">Where the numbers come from: </span>
          {page.source}
        </p>
      )}
    </article>
  );
}

function FinanceGuideContent() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const hubs = useMemo(
    () =>
      GUIDE_HUBS.map((hub) => ({
        ...hub,
        pages: q ? hub.pages.filter((page) => pageMatches(page, q) || hub.name.toLowerCase().includes(q)) : hub.pages,
      })).filter((hub) => hub.pages.length > 0),
    [q],
  );

  const glossary = useMemo(
    () =>
      q
        ? GUIDE_GLOSSARY.filter((g) => g.term.toLowerCase().includes(q) || g.meaning.toLowerCase().includes(q))
        : GUIDE_GLOSSARY,
    [q],
  );

  const nothingFound = q !== "" && hubs.length === 0 && glossary.length === 0;

  // While searching, only list the sections that are still on the page.
  const toc = useMemo(() => {
    if (!q) return TOC;
    const visible = new Set<string>(hubs.map((hub) => hub.id));
    if (glossary.length > 0) visible.add("glossary");
    return TOC.filter((item) => visible.has(item.id));
  }, [q, hubs, glossary]);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Finance Guide"
        subtitle="How the Finance module works, in plain language: where each number comes from and what to do on each screen."
        eyebrow={{ label: "Finance", icon: BookOpen }}
      />

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the guide, e.g. VAT, retention, payroll"
          aria-label="Search the finance guide"
          className="w-full rounded-sm border border-ink-mid bg-ink py-2 pl-9 pr-9 text-sm text-paper placeholder:text-slate focus:border-signal/50 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate hover:text-paper"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Guide contents" className="hidden lg:block">
          <div className="sticky top-4 space-y-1 border-l border-ink-mid">
            {toc.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="block border-l-2 border-transparent py-1 pl-3 -ml-px text-sm text-slate-light hover:border-signal hover:text-paper"
              >
                {item.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="min-w-0 space-y-12">
          {nothingFound && (
            <p className="rounded-sm border border-ink-mid bg-ink-light p-4 text-sm text-slate-light">
              Nothing in the guide matches &ldquo;{query.trim()}&rdquo;. Try a shorter word, or ask the{" "}
              <Link href="/dashboard/finance/ai-assistant" className="text-signal hover:text-paper">
                Finance AI Assistant
              </Link>
              .
            </p>
          )}

          {!q && (
            <>
              <section id="basics" className="scroll-mt-4">
                <SectionHeading
                  eyebrow="Start here"
                  title="The basics"
                  summary="Four ideas explain almost everything you will see in Finance."
                />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {GUIDE_PRINCIPLES.map((p, i) => (
                    <div key={p.title} className="rounded-sm border border-ink-mid bg-ink-light p-4">
                      <p className="font-mono text-xs text-signal">{String(i + 1).padStart(2, "0")}</p>
                      <h3 className="mt-1 text-base font-semibold text-paper">{p.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-slate-light">{p.body}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section id="flows" className="scroll-mt-4">
                <SectionHeading
                  eyebrow="The big picture"
                  title="How money moves"
                  summary="The four journeys that cover the money in and out of the business. Each step happens on a screen described further down."
                />
                <div className="space-y-4">
                  {GUIDE_FLOWS.map((flow) => (
                    <div key={flow.id} className="rounded-sm border border-ink-mid bg-ink-light p-4">
                      <h3 className="text-base font-semibold text-paper">{flow.name}</h3>
                      <p className="mt-1 text-sm text-slate-light">{flow.summary}</p>
                      <ol className="mt-4 flex flex-wrap items-stretch gap-2">
                        {flow.steps.map((step, i) => (
                          <li key={step.label} className="flex items-center gap-2">
                            <div className="max-w-[15rem] rounded-sm border border-ink-mid bg-ink px-3 py-2">
                              <p className="text-sm text-paper">
                                <span className="mr-1.5 font-mono text-xs text-signal">{i + 1}</span>
                                {step.label}
                              </p>
                              {step.note && <p className="mt-0.5 text-xs text-slate-light">{step.note}</p>}
                            </div>
                            {i < flow.steps.length - 1 && (
                              <ArrowRight aria-hidden className="hidden h-4 w-4 shrink-0 text-slate sm:block" />
                            )}
                          </li>
                        ))}
                      </ol>
                      <p className="mt-4 border-t border-ink-mid pt-3 text-sm text-slate-light">
                        <span className="font-semibold text-paper">Worth knowing: </span>
                        {flow.takeaway}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {hubs.map((hub) => (
            <section key={hub.id} id={hub.id} className="scroll-mt-4">
              <SectionHeading eyebrow="Screens" title={hub.name} summary={hub.summary} />
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {hub.pages.map((page) => (
                  <PageCard key={page.href} page={page} />
                ))}
              </div>
            </section>
          ))}

          {!q && (
            <>
              <section id="month-end" className="scroll-mt-4">
                <SectionHeading
                  eyebrow="Routine"
                  title="Month-end checklist"
                  summary="Work through these in order to close a month. Management Accounts shows a live close-readiness check for the first few."
                />
                <ol className="divide-y divide-ink-mid rounded-sm border border-ink-mid bg-ink-light">
                  {GUIDE_MONTH_END.map((item, i) => (
                    <li key={item.step} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <div className="flex gap-3">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                        <p className="text-sm text-paper">
                          <span className="mr-1.5 font-mono text-xs text-slate">{i + 1}.</span>
                          {item.step}
                        </p>
                      </div>
                      <Link
                        href={item.href}
                        className="ml-7 inline-flex shrink-0 items-center gap-1 text-xs text-signal hover:text-paper sm:ml-0"
                      >
                        {item.where} <ArrowRight className="h-3 w-3" />
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>

              <section id="accounts" className="scroll-mt-4">
                <SectionHeading
                  eyebrow="Reference"
                  title="Chart of accounts"
                  summary="Every organisation starts with this construction chart of accounts. In General Ledger, accounts can be added, renamed or deactivated, but never deleted, so past postings always keep their account."
                />
                <div className="divide-y divide-ink-mid rounded-sm border border-ink-mid bg-ink-light">
                  {GUIDE_ACCOUNT_RANGES.map((row) => (
                    <div key={row.range} className="grid grid-cols-1 gap-1 p-3 sm:grid-cols-[110px_190px_minmax(0,1fr)] sm:gap-4">
                      <p className="font-mono text-sm text-signal">{row.range}</p>
                      <p className="text-sm font-semibold text-paper">{row.group}</p>
                      <p className="text-sm text-slate-light">{row.examples}</p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {glossary.length > 0 && (
            <section id="glossary" className="scroll-mt-4">
              <SectionHeading eyebrow="Reference" title="Glossary" summary="Finance and construction terms used across these screens." />
              <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {glossary.map((g) => (
                  <div key={g.term} className="rounded-sm border border-ink-mid bg-ink-light p-3">
                    <dt className="text-sm font-semibold text-paper">{g.term}</dt>
                    <dd className="mt-1 text-sm text-slate-light">{g.meaning}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export function FinanceGuide() {
  return (
    <RBACGuard>
      <FinanceGuideContent />
    </RBACGuard>
  );
}
