export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ApiMeta;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface ApiMeta {
  timestamp: string;
  requestId: string;
}

export interface SupplierRegistrationPayload {
  companyName: string;
  registrationNumber: string;
  taxClearanceNumber: string;
  prazNumber?: string;
  yearEstablished: number;
  employees: number;
  address: string;
  contactPerson: string;
  email: string;
  phone: string;
  website?: string;
  categories: string[];
  description: string;
  provinces: string[];
  references: string;
  documents: {
    profileUrl: string;
    taxClearanceUrl: string;
    incorporationUrl: string;
    prazUrl?: string;
    isoUrl?: string;
  };
}

export interface EnquiryPayload {
  fullName: string;
  company: string;
  jobTitle: string;
  email: string;
  phone: string;
  type: string;
  province: string;
  budget?: string;
  message: string;
  attachmentUrl?: string;
}

export interface TenderInterestPayload {
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  registrationNumber: string;
  prazNumber?: string;
}

export interface JobApplicationPayload {
  positionId: string;
  fullName: string;
  email: string;
  phone: string;
  idNumber: string;
  province: string;
  nationality: string;
  experienceYears: number;
  highestQualification: string;
  institution: string;
  coverNote: string;
  documents: {
    cvUrl: string;
    idUrl: string;
    certificatesUrl?: string;
  };
}
