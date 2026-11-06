export type DeviceStatus = 'ACTIVE' | 'INACTIVE' | 'DECOMMISSIONED';

export interface Device {
  id: number;
  office_id: number;
  name: string;
  device_code: string;
  serial_number: string;
  model_name: string | null;
  ip_address: string | null;
  mac_address: string | null;
  status: DeviceStatus | string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeviceCreatePayload {
  office_id: number;
  name: string;
  device_code: string;
  serial_number: string;
  model_name?: string | null;
  ip_address?: string | null;
  mac_address?: string | null;
  status?: DeviceStatus;
  is_active?: boolean;
}

export interface DeviceUpdatePayload {
  office_id?: number;
  name?: string;
  device_code?: string;
  serial_number?: string;
  model_name?: string | null;
  ip_address?: string | null;
  mac_address?: string | null;
  status?: DeviceStatus;
  is_active?: boolean;
}
