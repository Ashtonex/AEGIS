export interface SubProject {
  id: string;
  title: string;
  status: ProjectStatus;
  budget: string;
  value: number;
  duration: string;
  scopeSummary: string;
  challenge: string;
  approach: string;
  outcomes: string[];
  gallery: string[];
}

export interface Project {
  id: string;
  slug: string;
  title: string;
  category: ProjectCategory;
  industry: Industry;
  province: string;
  status: ProjectStatus;
  value?: number;
  description: string;
  client: string;
  timeline: {
    start: string;
    end?: string;
  };
  contractType: string;
  scopeSummary: string;
  challenge: string;
  approach: string;
  outcomes: string[];
  featuredImage: string;
  gallery: string[];
  documents?: ProjectDocument[];
  subProjects?: SubProject[];
}

export type ProjectCategory = 
  | "Civil Infrastructure"
  | "Commercial Construction"
  | "Mining Infrastructure"
  | "Earthworks & Grading"
  | "Structural Engineering"
  | "Industrial Infrastructure"
  | "Institutional Buildings"
  | "Residential Development"
  | "Industrial Engineering"
  | "Industrial Plant"
  | "Commercial Renovation"
  | "Institutional Renovation"
  | "Civil Paving"
  | "Hospitality Renovation"
  | "Industrial Construction";

export type Industry = 
  | "Mining"
  | "Government"
  | "Commercial"
  | "Industrial"
  | "Energy"
  | "Transport"
  | "Agriculture"
  | "Infrastructure"
  | "Education"
  | "Hospitality";

export type ProjectStatus = "Active" | "Completed" | "Upcoming" | "In Progress";

export interface ProjectDocument {
  title: string;
  url: string;
  type: string;
}

export interface Tender {
  id: string;
  reference: string;
  title: string;
  category: string;
  province: string;
  issueDate: string;
  closingDate: string;
  estimatedValue?: number;
  status: "Open" | "Closing Soon" | "Closed" | "Awarded";
  description: string;
  requirements: string[];
  documents: { title: string; url: string }[];
  contactEmail: string;
}

export type ProcurementNoticeStatus =
  | "open"
  | "evaluating"
  | "awarded"
  | "in_delivery"
  | "fulfilled"
  | "dormant"
  | "cancelled";

/** A request for quotation or purchase order SNC has issued, as published on
 * the tender board. Carries no amounts or supplier names by design. */
export interface ProcurementNotice {
  reference: string;
  title: string;
  description: string | null;
  type: "Request for quotation" | "Direct purchase order";
  project: string | null;
  status: ProcurementNoticeStatus;
  status_label: string;
  status_description: string;
  published_at: string | null;
  closing_date: string | null;
  awarded_at: string | null;
  last_activity_at: string | null;
  accepting_quotations: boolean;
  contact_email: string;
  /** Only with ?code=: whether that AEGIS code belongs to an order under this notice. */
  code_matches?: boolean;
}

export interface Article {
  id: string;
  slug: string;
  title: string;
  category: ArticleCategory;
  publishDate: string;
  excerpt: string;
  content: string;
  featuredImage: string;
  author?: string;
}

export type ArticleCategory = 
  | "Press Release"
  | "Project Update"
  | "Company News"
  | "Award"
  | "Industry";

export interface JobPosition {
  id: string;
  title: string;
  department: string;
  location: string;
  type: "Full-Time" | "Contract" | "Graduate";
  postedDate: string;
  description: string;
  requirements: string[];
}

export interface LeadershipProfile {
  id: string;
  name: string;
  title: string;
  department: string;
  bio: string;
  image: string;
  linkedIn?: string;
}

export interface Capability {
  id: string;
  slug: string;
  name: string;
  description: string;
  statement: string;
  challenge: string;
  approach: string;
  breakdown: string[];
}
