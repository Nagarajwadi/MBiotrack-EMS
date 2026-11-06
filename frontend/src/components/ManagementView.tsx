import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getEmployees } from '../api/employeeApi';
import {
  createOffice,
  deactivateOffice,
  getOffices,
  updateOffice,
} from '../api/officeApi';
import {
  createDevice,
  deactivateDevice,
  decommissionDevice,
  getDevices,
  updateDevice,
} from '../api/deviceApi';
import {
  createAssignment,
  deleteAssignment,
  getAssignments,
} from '../api/assignmentApi';
import { ApiError } from '../api/apiError';
import type {
  AssignmentCreatePayload,
  OfficeAssignment,
} from '../types/assignment';
import type { User } from '../types/auth';
import type {
  Device,
  DeviceCreatePayload,
  DeviceUpdatePayload,
} from '../types/device';
import type { Employee } from '../types/employee';
import type {
  Office,
  OfficeCreatePayload,
  OfficeUpdatePayload,
} from '../types/office';
import {
  canCreateAssignment,
  canDeleteAssignment,
  canManageDevices,
  canManageOffices,
} from '../utils/permissions';
import { AssignmentModal } from './AssignmentModal';
import { DeviceModal } from './DeviceModal';
import { OfficeModal } from './OfficeModal';
import './components.css';

export interface ManagementViewProps {
  currentUser: User;
  sessionEpoch: number;
  onNavigateToDirectory?: () => void;
}

export type ManagementTab = 'offices' | 'devices' | 'assignments';

export const ManagementView: React.FC<ManagementViewProps> = ({
  currentUser,
  sessionEpoch,
  onNavigateToDirectory,
}) => {
  // Subnav tabs
  const [activeTab, setActiveTab] = useState<ManagementTab>('offices');

  // Core entities
  const [offices, setOffices] = useState<Office[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [assignments, setAssignments] = useState<OfficeAssignment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Loading & error states
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState<number>(0);
  const [referenceTime] = useState<number>(() => Date.now());

  // Filters
  const [officeSearch, setOfficeSearch] = useState<string>('');
  const [officeActiveOnly, setOfficeActiveOnly] = useState<boolean>(false);

  const [deviceOfficeFilter, setDeviceOfficeFilter] = useState<string>('ALL');
  const [deviceStatusFilter, setDeviceStatusFilter] = useState<string>('ALL');
  const [deviceSearch, setDeviceSearch] = useState<string>('');

  const [assignmentOfficeFilter, setAssignmentOfficeFilter] = useState<string>('ALL');
  const [assignmentEmployeeFilter, setAssignmentEmployeeFilter] = useState<string>('');

  // Modals state
  const [isOfficeModalOpen, setIsOfficeModalOpen] = useState<boolean>(false);
  const [officeModalMode, setOfficeModalMode] = useState<'create' | 'edit'>('create');
  const [selectedOffice, setSelectedOffice] = useState<Office | null>(null);
  const [isOfficeSubmitting, setIsOfficeSubmitting] = useState<boolean>(false);
  const [officeServerError, setOfficeServerError] = useState<string | null>(null);

  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState<boolean>(false);
  const [deviceModalMode, setDeviceModalMode] = useState<'create' | 'edit'>('create');
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [isDeviceSubmitting, setIsDeviceSubmitting] = useState<boolean>(false);
  const [deviceServerError, setDeviceServerError] = useState<string | null>(null);

  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState<boolean>(false);
  const [isAssignmentSubmitting, setIsAssignmentSubmitting] = useState<boolean>(false);
  const [assignmentServerError, setAssignmentServerError] = useState<string | null>(null);

  const sessionEpochRef = useRef<number>(sessionEpoch);
  useEffect(() => {
    sessionEpochRef.current = sessionEpoch;
  }, [sessionEpoch]);

  // Auto-dismiss feedback
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // Primary data synchronization
  useEffect(() => {
    let isMounted = true;
    const requestEpoch = sessionEpochRef.current;

    Promise.all([
      getOffices(),
      getDevices(),
      getAssignments(),
      getEmployees().catch(() => [] as Employee[]),
    ])
      .then(([officesRes, devicesRes, assignmentsRes, employeesRes]) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        setOffices(officesRes);
        setDevices(devicesRes);
        setAssignments(assignmentsRes);
        setEmployees(employeesRes);
        setError(null);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted || requestEpoch !== sessionEpochRef.current) return;
        const msg = err instanceof Error ? err.message : 'Failed to retrieve management data.';
        setError(msg);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [reloadTrigger]);

  // Quick lookup maps
  const officeMap = useMemo(() => {
    const map = new Map<number, Office>();
    offices.forEach((o) => map.set(o.id, o));
    return map;
  }, [offices]);

  const employeeMap = useMemo(() => {
    const map = new Map<number, Employee>();
    employees.forEach((e) => map.set(e.id, e));
    return map;
  }, [employees]);

  // Filtered lists
  const filteredOffices = useMemo(() => {
    return offices.filter((o) => {
      if (officeActiveOnly && !o.is_active) return false;
      if (officeSearch.trim()) {
        const q = officeSearch.toLowerCase().trim();
        const matchesName = o.name.toLowerCase().includes(q);
        const matchesCode = o.code.toLowerCase().includes(q);
        const matchesTz = o.timezone.toLowerCase().includes(q);
        return matchesName || matchesCode || matchesTz;
      }
      return true;
    });
  }, [offices, officeActiveOnly, officeSearch]);

  const filteredDevices = useMemo(() => {
    return devices.filter((d) => {
      if (deviceOfficeFilter !== 'ALL' && String(d.office_id) !== deviceOfficeFilter) {
        return false;
      }
      if (deviceStatusFilter !== 'ALL' && d.status !== deviceStatusFilter) {
        return false;
      }
      if (deviceSearch.trim()) {
        const q = deviceSearch.toLowerCase().trim();
        const matchesName = d.name.toLowerCase().includes(q);
        const matchesCode = d.device_code.toLowerCase().includes(q);
        const matchesSerial = d.serial_number.toLowerCase().includes(q);
        const matchesModel = d.model_name?.toLowerCase().includes(q) || false;
        return matchesName || matchesCode || matchesSerial || matchesModel;
      }
      return true;
    });
  }, [devices, deviceOfficeFilter, deviceStatusFilter, deviceSearch]);

  const filteredAssignments = useMemo(() => {
    return assignments.filter((a) => {
      if (assignmentOfficeFilter !== 'ALL' && String(a.office_id) !== assignmentOfficeFilter) {
        return false;
      }
      if (assignmentEmployeeFilter.trim()) {
        const q = assignmentEmployeeFilter.toLowerCase().trim();
        const emp = employeeMap.get(a.employee_id);
        const matchesId = String(a.employee_id) === q;
        const matchesCode = emp?.employee_code.toLowerCase().includes(q) || false;
        const matchesName =
          emp ? `${emp.first_name} ${emp.last_name}`.toLowerCase().includes(q) : false;
        return matchesId || matchesCode || matchesName;
      }
      return true;
    });
  }, [assignments, assignmentOfficeFilter, assignmentEmployeeFilter, employeeMap]);

  // Office actions
  const handleOpenCreateOffice = () => {
    setSelectedOffice(null);
    setOfficeModalMode('create');
    setOfficeServerError(null);
    setIsOfficeModalOpen(true);
  };

  const handleOpenEditOffice = (office: Office) => {
    setSelectedOffice(office);
    setOfficeModalMode('edit');
    setOfficeServerError(null);
    setIsOfficeModalOpen(true);
  };

  const handleOfficeSubmit = async (payload: OfficeCreatePayload | OfficeUpdatePayload) => {
    setIsOfficeSubmitting(true);
    setOfficeServerError(null);
    try {
      if (officeModalMode === 'create') {
        const created = await createOffice(payload as OfficeCreatePayload);
        setOffices((prev) => [...prev, created]);
        setFeedback({ type: 'success', message: `Office "${created.name}" created successfully.` });
      } else if (selectedOffice) {
        const updated = await updateOffice(selectedOffice.id, payload as OfficeUpdatePayload);
        setOffices((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
        setFeedback({ type: 'success', message: `Office "${updated.name}" updated successfully.` });
      }
      setIsOfficeModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to save office location.';
      setOfficeServerError(msg);
    } finally {
      setIsOfficeSubmitting(false);
    }
  };

  const handleDeactivateOffice = async (office: Office) => {
    if (!window.confirm(`Are you sure you want to deactivate office "${office.name}" (${office.code})?`)) {
      return;
    }
    try {
      const updated = await deactivateOffice(office.id);
      setOffices((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      setFeedback({ type: 'success', message: `Office "${office.name}" deactivated.` });
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to deactivate office.';
      setFeedback({ type: 'error', message: msg });
    }
  };

  // Device actions
  const handleOpenCreateDevice = () => {
    setSelectedDevice(null);
    setDeviceModalMode('create');
    setDeviceServerError(null);
    setIsDeviceModalOpen(true);
  };

  const handleOpenEditDevice = (device: Device) => {
    setSelectedDevice(device);
    setDeviceModalMode('edit');
    setDeviceServerError(null);
    setIsDeviceModalOpen(true);
  };

  const handleDeviceSubmit = async (payload: DeviceCreatePayload | DeviceUpdatePayload) => {
    setIsDeviceSubmitting(true);
    setDeviceServerError(null);
    try {
      if (deviceModalMode === 'create') {
        const created = await createDevice(payload as DeviceCreatePayload);
        setDevices((prev) => [...prev, created]);
        setFeedback({ type: 'success', message: `Device "${created.name}" registered successfully.` });
      } else if (selectedDevice) {
        const updated = await updateDevice(selectedDevice.id, payload as DeviceUpdatePayload);
        setDevices((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
        setFeedback({ type: 'success', message: `Device "${updated.name}" updated successfully.` });
      }
      setIsDeviceModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to save device terminal.';
      setDeviceServerError(msg);
    } finally {
      setIsDeviceSubmitting(false);
    }
  };

  const handleDeactivateDevice = async (device: Device) => {
    if (!window.confirm(`Deactivate device terminal "${device.name}" (${device.device_code})?`)) {
      return;
    }
    try {
      const updated = await deactivateDevice(device.id);
      setDevices((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setFeedback({ type: 'success', message: `Device "${device.name}" deactivated.` });
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to deactivate device.';
      setFeedback({ type: 'error', message: msg });
    }
  };

  const handleDecommissionDevice = async (device: Device) => {
    if (
      !window.confirm(
        `Are you sure you want to PERMANENTLY decommission device "${device.name}" (${device.device_code})? Once decommissioned, it cannot ingest punches.`
      )
    ) {
      return;
    }
    try {
      const updated = await decommissionDevice(device.id);
      setDevices((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setFeedback({ type: 'success', message: `Device "${device.name}" permanently decommissioned.` });
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to decommission device.';
      setFeedback({ type: 'error', message: msg });
    }
  };

  // Assignment actions
  const handleOpenCreateAssignment = () => {
    setAssignmentServerError(null);
    setIsAssignmentModalOpen(true);
  };

  const handleAssignmentSubmit = async (payload: AssignmentCreatePayload) => {
    setIsAssignmentSubmitting(true);
    setAssignmentServerError(null);
    try {
      const created = await createAssignment(payload);
      setAssignments((prev) => [...prev, created]);
      setFeedback({ type: 'success', message: 'Employee office assignment created successfully.' });
      setIsAssignmentModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to create office assignment.';
      setAssignmentServerError(msg);
    } finally {
      setIsAssignmentSubmitting(false);
    }
  };

  const handleDeleteAssignment = async (assignment: OfficeAssignment) => {
    if (!window.confirm(`Delete office assignment #${assignment.id}?`)) {
      return;
    }
    try {
      await deleteAssignment(assignment.id);
      setAssignments((prev) => prev.filter((a) => a.id !== assignment.id));
      setFeedback({ type: 'success', message: 'Office assignment removed.' });
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to delete office assignment.';
      setFeedback({ type: 'error', message: msg });
    }
  };

  const formatDateTime = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoStr;
    }
  };

  const getAssignmentStatus = (validFrom: string, validTo: string) => {
    const from = new Date(validFrom).getTime();
    const to = new Date(validTo).getTime();

    if (referenceTime < from) {
      return { label: 'Upcoming', className: 'badge-update' };
    }
    if (referenceTime >= to) {
      return { label: 'Expired', className: 'badge-inactive' };
    }
    return { label: 'Current', className: 'badge-create' };
  };

  return (
    <main className="dashboard-wrapper management-view-wrapper" aria-label="Management Administration View">
      {/* View Header */}
      <div className="dashboard-header-section">
        <div className="dashboard-heading">
          <h2>Offices, Devices & Assignments</h2>
          <p>Administer office facilities, terminal biometric hardware, and employee office assignments.</p>
        </div>
        <div className="dashboard-actions-group">
          {onNavigateToDirectory && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onNavigateToDirectory}
              title="Return to Employee Directory"
            >
              ← Back to Directory
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setIsLoading(true);
              setError(null);
              setReloadTrigger((prev) => prev + 1);
            }}
            disabled={isLoading}
            title="Refresh management records"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Notifications */}
      {feedback && (
        <div className={`alert-banner ${feedback.type}`} role="status" aria-live="polite" style={{ marginBottom: '1.25rem' }}>
          <div className="alert-content">
            <span aria-hidden="true">{feedback.type === 'success' ? '✓' : '⚠️'}</span>
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            className="alert-close"
            onClick={() => setFeedback(null)}
            aria-label="Close notification"
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="alert-banner error" role="alert" style={{ marginBottom: '1.25rem' }}>
          <div className="alert-content">
            <span aria-hidden="true">⚠️</span>
            <span>{error}</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setIsLoading(true);
              setError(null);
              setReloadTrigger((prev) => prev + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Subnav Tabs */}
      <div className="management-subnav" role="tablist" aria-label="Management sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'offices'}
          className={`nav-tab-btn ${activeTab === 'offices' ? 'active' : ''}`}
          onClick={() => setActiveTab('offices')}
        >
          🏢 Offices ({offices.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'devices'}
          className={`nav-tab-btn ${activeTab === 'devices' ? 'active' : ''}`}
          onClick={() => setActiveTab('devices')}
        >
          📟 Devices ({devices.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'assignments'}
          className={`nav-tab-btn ${activeTab === 'assignments' ? 'active' : ''}`}
          onClick={() => setActiveTab('assignments')}
        >
          👥 Office Assignments ({assignments.length})
        </button>
      </div>

      {isLoading ? (
        <div className="table-card" aria-busy="true" aria-live="polite">
          <div className="table-state-container">
            <div className="table-spinner" role="progressbar" aria-label="Loading management data" />
            <div className="table-state-title">Loading Administration Records...</div>
            <div className="table-state-description">Connecting to office and device registry</div>
          </div>
        </div>
      ) : (
        <>
          {/* ========================================================================= */}
          {/* TAB 1: OFFICES */}
          {/* ========================================================================= */}
          {activeTab === 'offices' && (
            <section aria-label="Offices Management">
              <div className="toolbar-card management-toolbar">
                <div className="toolbar-filters">
                  <div className="search-input-wrapper">
                    <span className="search-icon" aria-hidden="true">🔍</span>
                    <input
                      type="text"
                      value={officeSearch}
                      onChange={(e) => setOfficeSearch(e.target.value)}
                      placeholder="Search offices by name, code, timezone..."
                      aria-label="Search offices"
                    />
                  </div>
                  <label className="checkbox-label" style={{ marginLeft: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={officeActiveOnly}
                      onChange={(e) => setOfficeActiveOnly(e.target.checked)}
                    />
                    <span>Active Only</span>
                  </label>
                  {(officeSearch || officeActiveOnly) && (
                    <button
                      type="button"
                      className="btn-clear-filters"
                      onClick={() => {
                        setOfficeSearch('');
                        setOfficeActiveOnly(false);
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="toolbar-actions">
                  {canManageOffices(currentUser.role) && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleOpenCreateOffice}
                    >
                      + Add Office
                    </button>
                  )}
                </div>
              </div>

              {filteredOffices.length === 0 ? (
                <div className="table-card" role="region" aria-label="Empty offices list">
                  <div className="table-state-container">
                    <div className="table-state-icon" aria-hidden="true">🏢</div>
                    <div className="table-state-title">No Offices Found</div>
                    <div className="table-state-description">
                      {offices.length === 0
                        ? 'No office locations registered yet.'
                        : 'No offices match your search criteria.'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="table-card">
                  <div className="table-responsive">
                    <table className="mbiotrack-table" role="table" aria-label="Offices list">
                      <thead>
                        <tr>
                          <th scope="col">Code</th>
                          <th scope="col">Office Name</th>
                          <th scope="col">Timezone</th>
                          <th scope="col">Address</th>
                          <th scope="col">Status</th>
                          {canManageOffices(currentUser.role) && <th scope="col">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOffices.map((off) => (
                          <tr key={off.id}>
                            <td>
                              <span className="employee-code-badge">{off.code}</span>
                            </td>
                            <td>
                              <strong>{off.name}</strong>
                            </td>
                            <td>
                              <code>{off.timezone}</code>
                            </td>
                            <td>
                              <span className="text-muted">{off.address || '—'}</span>
                            </td>
                            <td>
                              <span
                                className={`audit-badge ${
                                  off.is_active ? 'badge-create' : 'badge-inactive'
                                }`}
                              >
                                {off.is_active ? 'ACTIVE' : 'INACTIVE'}
                              </span>
                            </td>
                            {canManageOffices(currentUser.role) && (
                              <td>
                                <div className="table-actions">
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleOpenEditOffice(off)}
                                    aria-label={`Edit office ${off.name}`}
                                  >
                                    Edit
                                  </button>
                                  {off.is_active && (
                                    <button
                                      type="button"
                                      className="btn btn-danger btn-sm"
                                      onClick={() => handleDeactivateOffice(off)}
                                      aria-label={`Deactivate office ${off.name}`}
                                    >
                                      Deactivate
                                    </button>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: DEVICES */}
          {/* ========================================================================= */}
          {activeTab === 'devices' && (
            <section aria-label="Devices Management">
              <div className="toolbar-card management-toolbar">
                <div className="toolbar-filters">
                  <div className="search-input-wrapper">
                    <span className="search-icon" aria-hidden="true">🔍</span>
                    <input
                      type="text"
                      value={deviceSearch}
                      onChange={(e) => setDeviceSearch(e.target.value)}
                      placeholder="Search devices by name, code, serial..."
                      aria-label="Search devices"
                    />
                  </div>

                  <select
                    className="filter-select"
                    value={deviceOfficeFilter}
                    onChange={(e) => setDeviceOfficeFilter(e.target.value)}
                    aria-label="Filter devices by office"
                  >
                    <option value="ALL">All Offices</option>
                    {offices.map((off) => (
                      <option key={off.id} value={off.id}>
                        {off.name} ({off.code})
                      </option>
                    ))}
                  </select>

                  <select
                    className="filter-select"
                    value={deviceStatusFilter}
                    onChange={(e) => setDeviceStatusFilter(e.target.value)}
                    aria-label="Filter devices by status"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                    <option value="DECOMMISSIONED">DECOMMISSIONED</option>
                  </select>

                  {(deviceSearch || deviceOfficeFilter !== 'ALL' || deviceStatusFilter !== 'ALL') && (
                    <button
                      type="button"
                      className="btn-clear-filters"
                      onClick={() => {
                        setDeviceSearch('');
                        setDeviceOfficeFilter('ALL');
                        setDeviceStatusFilter('ALL');
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="toolbar-actions">
                  {canManageDevices(currentUser.role) && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleOpenCreateDevice}
                    >
                      + Register Device
                    </button>
                  )}
                </div>
              </div>

              {filteredDevices.length === 0 ? (
                <div className="table-card" role="region" aria-label="Empty devices list">
                  <div className="table-state-container">
                    <div className="table-state-icon" aria-hidden="true">📟</div>
                    <div className="table-state-title">No Devices Found</div>
                    <div className="table-state-description">
                      {devices.length === 0
                        ? 'No terminal devices registered yet.'
                        : 'No devices match your filter criteria.'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="table-card">
                  <div className="table-responsive">
                    <table className="mbiotrack-table" role="table" aria-label="Devices list">
                      <thead>
                        <tr>
                          <th scope="col">Device Code</th>
                          <th scope="col">Name</th>
                          <th scope="col">Office Location</th>
                          <th scope="col">Serial Number</th>
                          <th scope="col">Network (IP/MAC)</th>
                          <th scope="col">Status</th>
                          {canManageDevices(currentUser.role) && <th scope="col">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDevices.map((dev) => {
                          const off = officeMap.get(dev.office_id);
                          const isDecom = dev.status === 'DECOMMISSIONED';
                          const isAct = dev.status === 'ACTIVE';

                          return (
                            <tr key={dev.id}>
                              <td>
                                <span className="employee-code-badge">{dev.device_code}</span>
                              </td>
                              <td>
                                <strong>{dev.name}</strong>
                                {dev.model_name && (
                                  <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                    Model: {dev.model_name}
                                  </div>
                                )}
                              </td>
                              <td>
                                {off ? (
                                  <span>{off.name} ({off.code})</span>
                                ) : (
                                  <span className="text-muted">Office #{dev.office_id}</span>
                                )}
                              </td>
                              <td>
                                <code>{dev.serial_number}</code>
                              </td>
                              <td>
                                <div style={{ fontSize: '0.8125rem' }}>
                                  {dev.ip_address && <div>IP: <code>{dev.ip_address}</code></div>}
                                  {dev.mac_address && <div>MAC: <code>{dev.mac_address}</code></div>}
                                  {!dev.ip_address && !dev.mac_address && <span className="text-muted">—</span>}
                                </div>
                              </td>
                              <td>
                                <span
                                  className={`audit-badge ${
                                    isAct
                                      ? 'badge-create'
                                      : isDecom
                                        ? 'badge-danger'
                                        : 'badge-inactive'
                                  }`}
                                  data-testid={`device-status-${dev.id}`}
                                >
                                  {dev.status}
                                </span>
                              </td>
                              {canManageDevices(currentUser.role) && (
                                <td>
                                  <div className="table-actions">
                                    {!isDecom && (
                                      <>
                                        <button
                                          type="button"
                                          className="btn btn-secondary btn-sm"
                                          onClick={() => handleOpenEditDevice(dev)}
                                          aria-label={`Edit device ${dev.name}`}
                                        >
                                          Edit
                                        </button>
                                        {isAct && (
                                          <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => handleDeactivateDevice(dev)}
                                            aria-label={`Deactivate device ${dev.name}`}
                                          >
                                            Deactivate
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          className="btn btn-danger btn-sm"
                                          onClick={() => handleDecommissionDevice(dev)}
                                          aria-label={`Decommission device ${dev.name}`}
                                        >
                                          Decommission
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ========================================================================= */}
          {/* TAB 3: ASSIGNMENTS */}
          {/* ========================================================================= */}
          {activeTab === 'assignments' && (
            <section aria-label="Assignments Management">
              <div className="toolbar-card management-toolbar">
                <div className="toolbar-filters">
                  <div className="search-input-wrapper">
                    <span className="search-icon" aria-hidden="true">🔍</span>
                    <input
                      type="text"
                      value={assignmentEmployeeFilter}
                      onChange={(e) => setAssignmentEmployeeFilter(e.target.value)}
                      placeholder="Filter by employee name, code, or ID..."
                      aria-label="Filter assignments by employee"
                    />
                  </div>

                  <select
                    className="filter-select"
                    value={assignmentOfficeFilter}
                    onChange={(e) => setAssignmentOfficeFilter(e.target.value)}
                    aria-label="Filter assignments by office"
                  >
                    <option value="ALL">All Offices</option>
                    {offices.map((off) => (
                      <option key={off.id} value={off.id}>
                        {off.name} ({off.code})
                      </option>
                    ))}
                  </select>

                  {(assignmentEmployeeFilter || assignmentOfficeFilter !== 'ALL') && (
                    <button
                      type="button"
                      className="btn-clear-filters"
                      onClick={() => {
                        setAssignmentEmployeeFilter('');
                        setAssignmentOfficeFilter('ALL');
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="toolbar-actions">
                  {canCreateAssignment(currentUser.role) && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleOpenCreateAssignment}
                    >
                      + Create Assignment
                    </button>
                  )}
                </div>
              </div>

              {filteredAssignments.length === 0 ? (
                <div className="table-card" role="region" aria-label="Empty assignments list">
                  <div className="table-state-container">
                    <div className="table-state-icon" aria-hidden="true">👥</div>
                    <div className="table-state-title">No Assignments Found</div>
                    <div className="table-state-description">
                      {assignments.length === 0
                        ? 'No employee office assignments created yet.'
                        : 'No assignments match your filter criteria.'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="table-card">
                  <div className="table-responsive">
                    <table className="mbiotrack-table" role="table" aria-label="Assignments list">
                      <thead>
                        <tr>
                          <th scope="col">Employee</th>
                          <th scope="col">Office Location</th>
                          <th scope="col">Effective Start</th>
                          <th scope="col">Effective End</th>
                          <th scope="col">Scope</th>
                          <th scope="col">Status</th>
                          {canDeleteAssignment(currentUser.role) && <th scope="col">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAssignments.map((assign) => {
                          const emp = employeeMap.get(assign.employee_id);
                          const off = officeMap.get(assign.office_id);
                          const statusInfo = getAssignmentStatus(assign.valid_from, assign.valid_to);

                          return (
                            <tr key={assign.id}>
                              <td>
                                <div>
                                  <strong>
                                    {emp ? `${emp.first_name} ${emp.last_name}` : `Employee #${assign.employee_id}`}
                                  </strong>
                                  {emp?.employee_code && (
                                    <span className="employee-code-badge" style={{ marginLeft: '0.35rem' }}>
                                      {emp.employee_code}
                                    </span>
                                  )}
                                </div>
                                {emp?.department && (
                                  <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                    {emp.department}
                                  </div>
                                )}
                              </td>
                              <td>
                                {off ? (
                                  <span>{off.name} ({off.code})</span>
                                ) : (
                                  <span className="text-muted">Office #{assign.office_id}</span>
                                )}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {formatDateTime(assign.valid_from)}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {formatDateTime(assign.valid_to)}
                              </td>
                              <td>
                                <span
                                  className={`audit-badge ${
                                    assign.is_primary ? 'badge-primary-scope' : 'badge-update'
                                  }`}
                                >
                                  {assign.is_primary ? 'PRIMARY' : 'SECONDARY'}
                                </span>
                              </td>
                              <td>
                                <span className={`audit-badge ${statusInfo.className}`}>
                                  {statusInfo.label}
                                </span>
                              </td>
                              {canDeleteAssignment(currentUser.role) && (
                                <td>
                                  <div className="table-actions">
                                    <button
                                      type="button"
                                      className="btn btn-danger btn-sm"
                                      onClick={() => handleDeleteAssignment(assign)}
                                      aria-label={`Delete assignment #${assign.id}`}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* Modals */}
      {canManageOffices(currentUser.role) && (
        <OfficeModal
          isOpen={isOfficeModalOpen}
          mode={officeModalMode}
          initialData={selectedOffice}
          isSubmitting={isOfficeSubmitting}
          serverError={officeServerError}
          onClose={() => setIsOfficeModalOpen(false)}
          onSubmit={handleOfficeSubmit}
        />
      )}

      {canManageDevices(currentUser.role) && (
        <DeviceModal
          isOpen={isDeviceModalOpen}
          mode={deviceModalMode}
          offices={offices}
          initialData={selectedDevice}
          isSubmitting={isDeviceSubmitting}
          serverError={deviceServerError}
          onClose={() => setIsDeviceModalOpen(false)}
          onSubmit={handleDeviceSubmit}
        />
      )}

      {canCreateAssignment(currentUser.role) && (
        <AssignmentModal
          isOpen={isAssignmentModalOpen}
          employees={employees}
          offices={offices}
          isSubmitting={isAssignmentSubmitting}
          serverError={assignmentServerError}
          onClose={() => setIsAssignmentModalOpen(false)}
          onSubmit={handleAssignmentSubmit}
        />
      )}
    </main>
  );
};
