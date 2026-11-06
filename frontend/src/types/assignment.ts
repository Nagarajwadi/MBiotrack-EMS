export interface OfficeAssignment {
  id: number;
  employee_id: number;
  office_id: number;
  valid_from: string;
  valid_to: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface AssignmentCreatePayload {
  employee_id: number;
  office_id: number;
  valid_from: string;
  valid_to: string;
  is_primary?: boolean;
}
