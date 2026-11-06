export interface Office {
  id: number;
  name: string;
  code: string;
  timezone: string;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OfficeCreatePayload {
  name: string;
  code: string;
  timezone?: string;
  address?: string | null;
  is_active?: boolean;
}

export interface OfficeUpdatePayload {
  name?: string;
  code?: string;
  timezone?: string;
  address?: string | null;
  is_active?: boolean;
}
