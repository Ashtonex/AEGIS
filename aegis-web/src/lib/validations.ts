import * as z from "zod";

export const EnquirySchema = z.object({
  fullName: z.string().min(2, "Name is required"),
  company: z.string().min(2, "Company is required"),
  jobTitle: z.string().min(2, "Job title is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(6, "Valid phone number required"),
  type: z.string().min(2, "Enquiry type is required"),
  province: z.string().min(2, "Province is required"),
  budget: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().min(0, "Budget must be a positive number").optional()),
  message: z.string().min(10, "Please provide more detail in your message"),
});

export const TenderInterestSchema = z.object({
  companyName: z.string().min(2, "Company name is required"),
  contactPerson: z.string().min(2, "Contact person is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(6, "Valid phone number required"),
  registrationNumber: z.string().min(2, "Registration number is required"),
  prazNumber: z.string().optional(),
});

export const JobApplicationSchema = z.object({
  positionId: z.string().min(1, "Position ID is required"),
  fullName: z.string().min(2, "Full name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(6, "Valid phone number required"),
  idNumber: z.string().min(5, "ID number is required"),
  province: z.string().min(2, "Province is required"),
  nationality: z.string().min(2, "Nationality is required"),
  experienceYears: z.number().min(0),
  highestQualification: z.string().min(2, "Highest qualification required"),
  institution: z.string().min(2, "Institution is required"),
  coverNote: z.string().min(10, "Cover note is required"),
});

export const SupplierRegistrationSchema = z.object({
  companyName: z.string().min(2, "Company name is required"),
  registrationNumber: z.string().min(2, "Registration number is required"),
  taxClearanceNumber: z.string().min(2, "Tax clearance is required"),
  prazNumber: z.string().optional(),
  yearEstablished: z.number().min(1900).max(new Date().getFullYear()),
  employees: z.number().min(1),
  address: z.string().min(10, "Full physical address required"),
  contactPerson: z.string().min(2, "Contact person is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(6, "Valid phone number required"),
  website: z.string().optional(),
  categories: z.array(z.string()).min(1, "Select at least one category"),
  description: z.string().min(10, "Provide a description of services"),
  provinces: z.array(z.string()).min(1, "Select at least one province"),
  references: z.string().min(10, "Provide at least one client reference"),
});
