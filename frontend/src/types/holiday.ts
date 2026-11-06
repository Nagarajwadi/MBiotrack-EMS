export interface HolidayDetail {
  id: number;
  holiday_date: string;
  name: string;
  description: string | null;
  office_id: number | null;
  office_name: string | null;
  office_code: string | null;
  is_optional: boolean;
  created_by_user_id: number;
  created_at: string;
  updated_at: string;
}

export interface HolidayCreatePayload {
  holiday_date: string;
  name: string;
  description?: string;
  office_id?: number | null;
  is_optional?: boolean;
}

export interface HolidayUpdatePayload {
  holiday_date?: string;
  name?: string;
  description?: string;
  office_id?: number | null;
  is_optional?: boolean;
}

export interface HolidayListResponse {
  items: HolidayDetail[];
  total: number;
}

export interface HolidayFilterParams {
  office_id?: number;
  start_date?: string;
  end_date?: string;
  include_org_wide?: boolean;
}
