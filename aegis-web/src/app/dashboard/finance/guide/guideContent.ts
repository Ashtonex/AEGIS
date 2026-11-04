/**
 * Plain-language content for the Finance Guide (/dashboard/finance/guide).
 *
 * Every statement here was checked against the code that does the work
 * (routers/ and app/services/finance/ in imperium-api) when it was written.
 * If you change how a finance flow behaves, update the matching entry here
 * so the guide doesn't drift from what the system actually does.
 */

export type GuidePage = {
  name: string;
  href: string;
  /** One line: what this screen is for. */
  purpose: string;
  /** What a person actually does here. */
  youDo: string[];
  /** Where the numbers on this screen come from, when that isn't obvious. */
  source?: string;
};

export type GuideHub = {
  id: string;
  name: string;
  summary: string;
  pages: GuidePage[];
};

export type GuideFlowStep = { label: string; note?: string };

export type GuideFlow = {
  id: string;
  name: string;
  summary: string;
  steps: GuideFlowStep[];
  takeaway: string;
};

export const GUIDE_PRINCIPLES: { title: string; body: string }[] = [
  {
    title: "Most numbers come from real work, not typing",
    body:
      "Costs, revenue, VAT and payroll tax appear in Finance because something happened elsewhere in AEGIS: a quotation was won, a purchase order was received, a progress claim was certified, a payroll run was posted, plant hours were logged. Finance mostly reviews, approves and reconciles; it rarely captures from scratch.",
  },
  {
    title: "Nothing reaches the General Ledger without a person approving it",
    body:
      "When a claim is certified, a supplier invoice is approved for payment, a payment batch or payroll run is posted, or retention is released, AEGIS writes a proposed journal. It only becomes part of the books once someone approves it in General Ledger. Project cost transactions are proposed when Finance asks for them (Sync on a project), not automatically.",
  },
  {
    title: "Posted journals are never edited",
    body:
      "A journal only posts when debits equal credits. Once posted it cannot change: mistakes are fixed with a reversal or a correcting journal, so the full history is always visible in the Audit Workspace.",
  },
  {
    title: "Periods close, then lock",
    body:
      "Each month is an accounting period: open, then soft-closed, closed, audited and finally locked. Journals can only post into open or soft-closed periods, a period cannot close while draft journals remain in it, and reopening needs a written reason that is kept in the audit trail.",
  },
];

export const GUIDE_FLOWS: GuideFlow[] = [
  {
    id: "revenue",
    name: "Money in: from a won quote to cash received",
    summary: "How a project's income is set up, claimed from the client, taxed and collected.",
    steps: [
      { label: "Quotation won", note: "The project budget is seeded from the quote's cost breakdown" },
      { label: "Variations", note: "Approved changes adjust what the client owes" },
      { label: "Progress claim submitted" },
      { label: "Claim certified", note: "Locks the amount, works out VAT, proposes a revenue journal" },
      { label: "Fiscal invoice recorded" },
      { label: "Client pays", note: "Receipt is allocated to the claim" },
      { label: "Retention released", note: "At close-out; proposes a journal" },
    ],
    takeaway:
      "Certifying a claim is the moment revenue and output VAT are recognised. VAT uses the active VAT rate table for the certification date; if no table covers that date, no VAT is added to the claim.",
  },
  {
    id: "spend",
    name: "Money out: from a requisition to a paid supplier",
    summary: "How a purchase becomes a commitment, a payable and finally a payment.",
    steps: [
      { label: "Requisition" },
      { label: "Purchase order", note: "Becomes a committed cost on the project" },
      { label: "Goods received (GRN)" },
      { label: "Supplier invoice", note: "Checked against the PO and what was received" },
      { label: "Approved for payment", note: "Proposes a payable journal, including input VAT" },
      { label: "Payment batch: draft → approved → posted", note: "Posting proposes the payment journal" },
    ],
    takeaway:
      "Plant hire, fuel and payroll are costs too. Internal plant hire between departments is recorded as an internal transfer, so it moves cost between departments without inflating company revenue.",
  },
  {
    id: "bank",
    name: "The bank: statement in, books matched",
    summary: "How the bank statement is used to prove the cashbook is complete.",
    steps: [
      { label: "Upload statement", note: "CSV, or a BancABC PDF" },
      { label: "Automatic matching", note: "Each line is matched, suggested or left unmatched" },
      { label: "Confirm or reject suggestions" },
      { label: "Tag lines", note: "Project, category, counterparty; rules can do this for you" },
      { label: "Unmatched line → cashbook entry" },
      { label: "Sync books & audit", note: "Proves every statement line is in the books" },
    ],
    takeaway:
      "Tagging a statement line classifies it; it is not proof that an invoice was settled. The audit check shows whether every statement line has been carried into the books.",
  },
  {
    id: "close",
    name: "Month end: from journals to a board pack",
    summary: "How a month is checked, closed and reported.",
    steps: [
      { label: "Approve GL proposals" },
      { label: "Post or delete draft journals" },
      { label: "Reconcile the bank" },
      { label: "Resolve control findings" },
      { label: "Trial balance & statements" },
      { label: "Close then lock the period" },
      { label: "Management accounts pack", note: "draft → reviewed → approved → locked, with PDF export" },
    ],
    takeaway:
      "Management Accounts shows a close-readiness check covering draft journals, unmatched bank lines, open control findings and the cash-advances balance (account 1500).",
  },
];

export const GUIDE_HUBS: GuideHub[] = [
  {
    id: "command-center",
    name: "Command Center",
    summary: "Start here every day: what needs attention across all of Finance.",
    pages: [
      {
        name: "Overview & Action Inbox",
        href: "/dashboard/finance",
        purpose: "The headline position of the business and a to-do list of items waiting on Finance.",
        youDo: [
          "Switch between Consolidated and a single department",
          "Work through the action inbox: approvals, overruns, untagged bank lines",
        ],
        source:
          "Actual cost, committed cost and forecast margin are totals over real transactions, updated as they post. If a project's forecast cost passes its approved budget without an approved variation, Finance managers are notified.",
      },
      {
        name: "AI Assistant",
        href: "/dashboard/finance/ai-assistant",
        purpose: "Ask questions about the books in plain English.",
        youDo: [
          "Ask about the trial balance, a project's ledger, VAT position, tax deadlines, cash runway or budget variance",
          "Search the text of finance documents",
        ],
        source: "Answers are built from the same live data as the other screens. Every question is kept in an audit log.",
      },
    ],
  },
  {
    id: "project-commercials",
    name: "Project Commercials",
    summary: "Everything about one project's money: budget, changes, claims and close-out.",
    pages: [
      {
        name: "Project Financials",
        href: "/dashboard/finance/project-financials",
        purpose: "Budget, actual, committed and forecast for each project, side by side.",
        youDo: ["Open a project to see its ledger", "Record money directly against a project (claim, cost, petty cash)"],
        source:
          "Money recorded straight onto a project is in the books as soon as it is saved. Bank entries are paired with their statement line when the statement is uploaded, and anything uncertain is asked about here.",
      },
      {
        name: "Budgets",
        href: "/dashboard/finance/budgets",
        purpose: "Project budgets and the company-wide budget.",
        youDo: ["Review budgets seeded from won quotations", "Set and track the company budget by department"],
        source: "A won quotation seeds the project budget from its own cost breakdown, with protected profit left out, so quoted cost and actual spend compare like for like.",
      },
      {
        name: "Cost Codes",
        href: "/dashboard/finance/cost-codes",
        purpose: "The cost headings each project's spending is booked against.",
        youDo: ["Add cost codes", "See spend by code on each project"],
      },
      {
        name: "Variations",
        href: "/dashboard/finance/variations",
        purpose: "Changes to the contract: extra work, omissions, time extensions.",
        youDo: ["Raise a variation with its cost and time impact", "Record the decision (approve or reject)"],
        source: "Only approved variations count towards the contract value and budget comparisons.",
      },
      {
        name: "Progress Claims",
        href: "/dashboard/finance/progress-claims",
        purpose: "Claims to the client for work done, and their certification.",
        youDo: ["Create a claim for a period with its retention %", "Certify it", "Record the fiscal invoice"],
        source: "Certification sets the certified amount, accrues output VAT and proposes the revenue journal.",
      },
      {
        name: "Earned Value",
        href: "/dashboard/finance/earned-value",
        purpose: "Is the project on budget and on schedule? (CPI and SPI)",
        youDo: ["Read the cost and schedule performance of each project"],
      },
      {
        name: "Close-Out",
        href: "/dashboard/finance/close-out",
        purpose: "The final account at the end of a project.",
        youDo: ["Prepare the final account", "Move it through negotiation to agreed, then closed", "Release retention"],
      },
      {
        name: "Client Payments",
        href: "/dashboard/finance/client-payments",
        purpose: "Payment requests sent to clients, which they also see in their client portal.",
        youDo: ["Send a request", "Mark it cleared when paid; track viewed and disputed requests"],
      },
      {
        name: "Project Portfolio",
        href: "/dashboard/finance/project-portfolio",
        purpose: "Health of all projects at once, with the factors behind each score.",
        youDo: ["Spot projects that need attention"],
      },
      {
        name: "Official Invoices (PDF)",
        href: "/dashboard/finance/invoices",
        purpose: "Produce the official invoice documents.",
        youDo: ["Generate and download invoice PDFs"],
      },
    ],
  },
  {
    id: "treasury",
    name: "Treasury & Banking",
    summary: "Bank accounts, the cashbook and proving the books match the bank.",
    pages: [
      {
        name: "Banking & Cash",
        href: "/dashboard/finance/banking",
        purpose: "Bank and cash accounts with their balances, including project petty cash.",
        youDo: ["Add cash accounts", "Spend, replenish or close a project petty-cash float"],
      },
      {
        name: "Cashbook",
        href: "/dashboard/finance/cashbook",
        purpose: "Every receipt and payment through the bank and cash accounts.",
        youDo: ["Record a transaction", "Edit it while it is unposted", "Void it (it is kept, not deleted)"],
      },
      {
        name: "Bank Statement Review",
        href: "/dashboard/finance/bank-review",
        purpose: "Upload bank statements and match every line to the books.",
        youDo: [
          "Upload a CSV or BancABC PDF statement",
          "Confirm or reject suggested matches",
          "Tag lines with project and category, or split one line across several",
          "Create a cashbook entry from a line that has no match",
          "Set up auto-tagging rules (they only fill empty tags and always preview first)",
        ],
      },
      {
        name: "Cash Forecast",
        href: "/dashboard/finance/cash-forecast",
        purpose: "When cash is likely to arrive and how long current cash will last.",
        youDo: ["Read expected receipts and cash runway"],
        source: "Each client's open claims are dated using how long that client has actually taken to pay before (median days from certification to receipt).",
      },
    ],
  },
  {
    id: "payables",
    name: "Payables & Payroll",
    summary: "What the business owes: suppliers, staff and ZIMRA/NSSA.",
    pages: [
      {
        name: "Supplier Payments",
        href: "/dashboard/finance/supplier-payments",
        purpose: "What is owed to suppliers and how overdue it is (AP aging).",
        youDo: [
          "For each invoice: pay it, ask the supplier for a proper invoice, or reject it",
          "Tick several invoices to pay them in one batch",
          "Approve, then post the batch",
        ],
        source: "An invoice with no due date is treated as due 30 days after its invoice date.",
      },
      {
        name: "Vendor Payments",
        href: "/dashboard/finance/vendor-payments",
        purpose: "Payment requests raised by suppliers and subcontractors from their vendor portal.",
        youDo: ["Review and action open requests"],
      },
      {
        name: "Payroll",
        href: "/dashboard/finance/payroll",
        purpose: "Monthly staff payroll and site (hourly) payroll.",
        youDo: [
          "Staff: create a draft run, approve it, then post it",
          "Site: pick a project, enter hours for site workers not registered in HR, print the wages sheet",
        ],
        source:
          "Posting a run accrues PAYE, AIDS levy and NSSA and proposes the payroll journal, split by project. A run cannot be calculated until the PAYE and NSSA rate tables are set up in Statutory, so tax is never silently zero.",
      },
      {
        name: "Statutory",
        href: "/dashboard/finance/statutory",
        purpose: "Tax rate tables and what is owed to ZIMRA and NSSA.",
        youDo: [
          "Enter the official rate tables (PAYE, NSSA, VAT) with the dates they apply from",
          "Set the VAT filing profile (otherwise periods default to calendar months)",
          "Mark liabilities as filed, then settle them",
          "Check the VAT net position and the tax calendar",
        ],
        source:
          "Liabilities build up automatically from certified claims (VAT) and posted payroll (PAYE/NSSA). Recompute re-derives a period from its source records and is safe to run again. Fiscal device details are kept for reference only; AEGIS does not connect to fiscal devices.",
      },
    ],
  },
  {
    id: "ledger",
    name: "General Ledger & Reports",
    summary: "The double-entry books, the reports built from them, and the evidence behind them.",
    pages: [
      {
        name: "General Ledger",
        href: "/dashboard/finance/general-ledger",
        purpose: "Chart of accounts, journals, proposals from the rest of AEGIS, and accounting periods.",
        youDo: [
          "Approve or reject proposed journals",
          "Create a manual journal, post it, or reverse a posted one",
          "Add accounts to the chart of accounts",
          "Soft-close, close, lock or reopen a period (reopening needs a reason)",
        ],
      },
      {
        name: "Financial Statements",
        href: "/dashboard/finance/financial-statements",
        purpose: "Income statement, balance sheet, cash movement, trial balance, and AR/AP aging.",
        youDo: ["Pick a period and read the statements"],
        source: "Built from posted journals only; drafts and unapproved proposals are not included.",
      },
      {
        name: "Management Accounts",
        href: "/dashboard/finance/management-accounts",
        purpose: "The monthly pack for management and the board, plus close readiness.",
        youDo: ["Create a pack, recompute it, submit for review, approve, lock", "Export the pack as a PDF"],
      },
      {
        name: "Internal Transfers",
        href: "/dashboard/finance/transfers",
        purpose: "Money and costs moving between departments, such as internal plant hire.",
        youDo: ["Record a transfer", "Reverse one that was wrong", "Manage the rules that create transfers automatically"],
        source: "Logged plant hours create internal plant-hire transfers automatically.",
      },
      {
        name: "Department P&L",
        href: "/dashboard/finance/department-pnl",
        purpose: "Profit and loss for each department, including internal transfers.",
        youDo: ["Compare departments' results"],
      },
      {
        name: "Historical Entry",
        href: "/dashboard/finance/historical-entry",
        purpose: "Backfill history from before AEGIS was used.",
        youDo: ["Record each old project's revenue and the activities that made up its cost, with the quality of the evidence"],
        source: "It writes into the same tables as live work, so budgets, cash position and runway include it automatically.",
      },
      {
        name: "Audit Workspace",
        href: "/dashboard/finance/audit-workspace",
        purpose: "Read-only drill-down for auditors.",
        youDo: ["Open any journal to see its lines, the real-world event that produced it, and its full change history"],
      },
      {
        name: "Financial Data Room",
        href: "/dashboard/finance/data-room",
        purpose: "The organised document set for banks, auditors and investors.",
        youDo: ["Upload documents into the structured folders (stored in SharePoint)", "Download the whole data room as a ZIP with a manifest"],
      },
    ],
  },
];

export const GUIDE_MONTH_END: { step: string; where: string; href: string }[] = [
  { step: "Approve or reject every proposed journal", where: "General Ledger → Proposals", href: "/dashboard/finance/general-ledger" },
  { step: "Post or delete remaining draft journals", where: "General Ledger → Journals", href: "/dashboard/finance/general-ledger" },
  { step: "Upload the month's bank statements and clear unmatched lines", where: "Bank Statement Review", href: "/dashboard/finance/bank-review" },
  { step: "Settle or file the period's VAT, PAYE and NSSA", where: "Statutory", href: "/dashboard/finance/statutory" },
  { step: "Resolve open control findings", where: "Overview & Action Inbox", href: "/dashboard/finance" },
  { step: "Check the trial balance and statements", where: "Financial Statements", href: "/dashboard/finance/financial-statements" },
  { step: "Soft-close, then close the period", where: "General Ledger → Periods", href: "/dashboard/finance/general-ledger" },
  { step: "Prepare, approve and lock the management accounts pack", where: "Management Accounts", href: "/dashboard/finance/management-accounts" },
];

export const GUIDE_ACCOUNT_RANGES: { range: string; group: string; examples: string }[] = [
  { range: "1000–1900", group: "Assets", examples: "1000 Cash and Bank · 1100 Accounts Receivable · 1200 Retention Receivable · 1500 Cash Advances · 1900 Suspense" },
  { range: "2000–2500", group: "Liabilities", examples: "2000 Accounts Payable · 2100 Accrued Project Costs · 2300 Client Deposits · 2400 Payroll Liabilities" },
  { range: "3000–3300", group: "Equity", examples: "3000 Share Capital · 3100 Retained Earnings · 3200 Directors' Accounts" },
  { range: "4000–4900", group: "Revenue & other income", examples: "4100 Certified Revenue · 4200 Uncertified Revenue · 4900 Other Income" },
  { range: "5000–5900", group: "Direct project costs", examples: "5000 Materials · 5100 Direct Labour · 5200 Subcontractors · 5300 Plant Hire · 5400 Fuel" },
  { range: "6000–6800", group: "Overheads", examples: "6000 HQ Salaries · 6100 Rent · 6300 Professional Fees · 6800 Finance Costs" },
  { range: "7900", group: "Other expense", examples: "7900 Other Expense" },
  { range: "8000–8200", group: "Tax", examples: "8000 VAT Payable · 8100 PAYE Payable · 8200 NSSA Payable" },
];

export const GUIDE_GLOSSARY: { term: string; meaning: string }[] = [
  { term: "Accounting period", meaning: "Usually one month. Journals are dated into a period; a closed or locked period accepts no new postings." },
  { term: "AP / AR aging", meaning: "What we owe suppliers (payables) and what clients owe us (receivables), grouped by how overdue it is." },
  { term: "Certification", meaning: "The client's agreement to the value of a progress claim. In AEGIS it is the moment revenue and output VAT are recognised." },
  { term: "Chart of accounts", meaning: "The list of ledger accounts every journal line posts to. A starter construction chart is set up for you; accounts can be added or deactivated, never deleted." },
  { term: "Committed cost", meaning: "Money promised but not yet spent, mainly approved purchase orders." },
  { term: "Control account", meaning: "A ledger account that summarises a detailed sub-ledger, such as Accounts Payable for all suppliers." },
  { term: "Control findings", meaning: "Issues the system's commercial controls flag on a schedule, such as budget overruns or unusual fuel use. They stay open until resolved." },
  { term: "Cost code", meaning: "A heading project spending is booked against, so costs can be compared with the budget line by line." },
  { term: "CPI / SPI", meaning: "Cost and schedule performance index. Above 1 is better than plan; below 1 is over budget or behind schedule." },
  { term: "Final account", meaning: "The agreed total value of a contract at the end of a project, after all variations and claims." },
  { term: "GRN", meaning: "Goods Received Note: the record that what was ordered actually arrived." },
  { term: "Journal", meaning: "A balanced set of debit and credit lines. Draft until posted; never edited after posting." },
  { term: "NSSA", meaning: "National Social Security Authority contributions, deducted from employees and also paid by the employer." },
  { term: "PAYE / AIDS levy", meaning: "Income tax withheld from salaries, and the levy charged on top of it, both paid to ZIMRA." },
  { term: "Proposal (GL)", meaning: "A journal AEGIS has prepared from a real event. It waits for a person to approve it before it is posted." },
  { term: "Retention", meaning: "A percentage of each claim the client holds back until the work is complete, then releases." },
  { term: "Reversal", meaning: "A new journal that cancels a posted one, used instead of editing it." },
  { term: "Soft close", meaning: "A period that is finishing up: still open for posting, but signalling that the month is being closed." },
  { term: "Suspense account", meaning: "Account 1900, a temporary home for amounts that still need to be classified. It should be cleared before close." },
  { term: "Three-way match", meaning: "Checking a supplier invoice against the purchase order and the goods received before paying it." },
  { term: "Variation", meaning: "A change to the contract (extra work, omission or time) that changes what the client pays once approved." },
  { term: "VAT (output / input)", meaning: "VAT charged to clients on certified claims (output) and VAT paid on supplier invoices (input). The difference is what is owed to ZIMRA." },
];
