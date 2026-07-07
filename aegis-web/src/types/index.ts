export interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  message: string;
  meta: Record<string, any>;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    detail: string;
  };
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  organization_id: string;
  is_active: boolean;
}
