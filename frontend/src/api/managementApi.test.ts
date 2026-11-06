import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOffice,
  deactivateOffice,
  getOffice,
  getOffices,
  updateOffice,
} from './officeApi';
import {
  createDevice,
  deactivateDevice,
  decommissionDevice,
  getDevice,
  getDevices,
  updateDevice,
} from './deviceApi';
import {
  createAssignment,
  deleteAssignment,
  getAssignment,
  getAssignments,
} from './assignmentApi';

describe('Management API clients', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch = vi.fn<typeof fetch>();

  beforeEach(() => {
    mockFetch = vi.fn<typeof fetch>();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('officeApi', () => {
    it('getOffices requests /api/v1/offices and handles activeOnly filter', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      await getOffices();
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/offices', expect.anything());

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      await getOffices(true);
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/offices?active_only=true', expect.anything());
    });

    it('createOffice sends POST with JSON payload', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1, name: 'HQ', code: 'HQ' }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      );
      await createOffice({ name: 'HQ', code: 'HQ', timezone: 'Asia/Kolkata' });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/offices',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'HQ', code: 'HQ', timezone: 'Asia/Kolkata' }),
        })
      );
    });

    it('getOffice requests /api/v1/offices/:id', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1, name: 'HQ' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      await getOffice(1);
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/offices/1', expect.anything());
    });

    it('updateOffice sends PATCH with payload', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1, name: 'HQ Updated' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      await updateOffice(1, { name: 'HQ Updated' });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/offices/1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'HQ Updated' }),
        })
      );
    });

    it('deactivateOffice sends DELETE', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1, is_active: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      await deactivateOffice(1);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/offices/1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('deviceApi', () => {
    it('getDevices constructs query parameters correctly', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      await getDevices({ office_id: 2, status: 'ACTIVE', active_only: true });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/devices?office_id=2&status=ACTIVE&active_only=true',
        expect.anything()
      );
    });

    it('createDevice sends POST', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 10 }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      );
      await createDevice({
        office_id: 1,
        name: 'Gate 1',
        device_code: 'DEV-01',
        serial_number: 'SN-001',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/devices',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('getDevice requests /api/v1/devices/:id', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 10 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      await getDevice(10);
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/devices/10', expect.anything());
    });

    it('updateDevice sends PATCH', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 10, name: 'Gate 1 Updated' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      await updateDevice(10, { name: 'Gate 1 Updated' });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/devices/10',
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('decommissionDevice sends POST to /decommission', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 10, status: 'DECOMMISSIONED' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      await decommissionDevice(10);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/devices/10/decommission',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('deactivateDevice sends DELETE', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 10, is_active: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      await deactivateDevice(10);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/devices/10',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('assignmentApi', () => {
    it('getAssignments constructs query parameters', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      await getAssignments({ employee_id: 5, office_id: 2 });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/offices/assignments?employee_id=5&office_id=2',
        expect.anything()
      );
    });

    it('getAssignment requests /api/v1/offices/assignments/:id', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 100 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      await getAssignment(100);
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/offices/assignments/100', expect.anything());
    });

    it('createAssignment sends POST', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 100 }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      );
      await createAssignment({
        employee_id: 1,
        office_id: 2,
        valid_from: '2026-01-01T00:00:00Z',
        valid_to: '2026-12-31T23:59:59Z',
        is_primary: true,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/offices/assignments',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('deleteAssignment sends DELETE and handles 204 No Content', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(null, { status: 204 })
      );
      await deleteAssignment(100);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/offices/assignments/100',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });
});
