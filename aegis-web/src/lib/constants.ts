export const SITE_CONFIG = {
  name: "Six Nine Construction (Private) Limited",
  shortName: "SNC",
  tagline: "Built to Last. Engineered to Perform.",
  description: "Civil engineering, commercial construction, and mining infrastructure delivered with precision across Zimbabwe and Southern Africa.",
  url: "https://sixnine.co.zw", // Assuming generic URL
  contact: {
    email: "commercial@sixnine.co.zw",
    phone: "+263 242 000 000",
    address: "Harare, Zimbabwe", // Generic address
    emergency: "+263 772 000 000"
  },
  social: {
    linkedin: "https://linkedin.com/company/six-nine-constructions",
    x: "https://x.com/sixnineconstructions",
    youtube: "https://youtube.com/@sixnineconstructions"
  }
};

export const PROVINCES = [
  "Harare",
  "Bulawayo",
  "Manicaland",
  "Mashonaland Central",
  "Mashonaland East",
  "Mashonaland West",
  "Masvingo",
  "Matabeleland North",
  "Matabeleland South",
  "Midlands"
];

export const CAPABILITIES = [
  "Civil Infrastructure",
  "Mining Infrastructure",
  "Commercial Construction",
  "Structural Engineering",
  "Earthworks & Grading",
  "Heavy Plant Operations",
  "Project Controls",
  "Design & Build"
];

export const INDUSTRIES = [
  "Mining",
  "Government",
  "Commercial",
  "Industrial",
  "Energy",
  "Transport",
  "Agriculture",
  "Infrastructure"
];

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
