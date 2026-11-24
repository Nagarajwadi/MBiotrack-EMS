# MBiotrack-EMS
**Workforce & Biometric Attendance Management System (MVP)**

MBiotrack-EMS is a comprehensive role-based workforce management and attendance tracking platform built with FastAPI, PostgreSQL, and React 19. It provides robust employee management, role-based access control (RBAC), multi-office and device registry management, attendance punch ingestion and daily reconciliation, attendance corrections, working-day leave calculations, entitlements with balance ledger tracking, user administration, and tamper-evident audit logging.

> [!NOTE]
> **Project Status & Biometric Scope Notice:**
> - **Verified Application MVP:** All core functional domains—including employee lifecycle, role-based authorization, multi-office assignments, device registries, attendance reconciliation, attendance corrections, daily worked-duration reports, working-day leave calculations, leave entitlements and balance ledgers, user administration, and audit logging—are **fully implemented and verified**.
> - **Biometric Hardware Caveat:** Physical biometric hardware capture (e.g., optical/capacitive fingerprint scanning, facial recognition cameras) and manufacturer-specific device firmware protocols have **not been verified** with physical hardware devices. Attendance event ingestion currently operates via standardized API endpoints (`/api/v1/attendance/ingest`) and authenticated manual web punches.
> - **Deployment Status:** This repository represents the verified, staging-ready application MVP. It does not claim active production deployment.

---

## Table of Contents
- [Core Features & Capabilities](#core-features--capabilities)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Database Migrations Chain](#database-migrations-chain)
- [Prerequisites](#prerequisites)
- [Local Windows Development Setup](#local-windows-development-setup)
- [Initial Administrator Setup (Bootstrap CLI)](#initial-administrator-setup-bootstrap-cli)
- [API & Role-Based Access Control (RBAC) Overview](#api--role-based-access-control-rbac-overview)
- [Automated Testing & Quality Checks](#automated-testing--quality-checks)
- [Project Status & Roadmap](#project-status--roadmap)

---

## Core Features & Capabilities

### 1. Workforce & Employee Management
- **Directory & Profiles:** Comprehensive employee directory with search, department filtering, and pagination.
- **Role Separation:** Strict boundaries separating `ADMIN`, `MANAGER`, and `EMPLOYEE` operations.
- **Self-Service:** Employees can view their personal profile card and request updates to allowable self-service fields.
- **Soft Deletion & Auditing:** Soft deactivation preserves referential integrity while recording immutable audit trail entries.

### 2. Authentication, RBAC & Security
- **Argon2id Hashing:** Password hashing utilizing modern memory-hard Argon2id via `pwdlib`.
- **In-Memory JWT:** Short-lived (15-minute) JSON Web Tokens stored exclusively in memory (zero `localStorage` or `sessionStorage` token exposure).
- **IP Rate Limiting:** In-memory sliding-window IP rate limiting on login attempts to mitigate brute-force attacks.
- **Audit Logging:** Synchronous, transactional audit logging for administrative actions, authentication events, and data mutations.

### 3. Offices, Devices & Employee Assignments
- **Multi-Office Support:** Configure organizational offices with regional timezones (e.g., `Asia/Kolkata`) and geographic metadata.
- **Device Registry:** Register biometric terminals with unique device keys, heartbeat tracking, status indicators, and office linkage.
- **Office Assignments:** Explicit assignments linking employees to authorized primary and secondary office locations.

### 4. Attendance Tracking, Corrections & Reporting
- **Punch Ingestion & Web Punches:** Ingestion endpoint for biometric terminal telemetry (`CHECK_IN`, `CHECK_OUT`) alongside self-service web punching.
- **Session Reconciliation:** Daily attendance aggregation pairing check-in and check-out events to calculate daily worked duration.
- **Manager Reviews:** Manager dashboard flagging incomplete punches, single punches, or review-required anomalies within their department.
- **Attendance Corrections:** Employees can submit time adjustment or missing punch correction requests; managers and admins review, approve, or reject requests with atomic attendance session updates.
- **Attendance Reports:** Comprehensive reports with date range, office, employee, and department filtering (enforcing department isolation for managers) with CSV export support.

### 5. Leave Management, Entitlements & Balance Ledger
- **Working-Day Calculation:** Accurate working-day duration calculation excluding weekends (office-specific) and configured public holidays.
- **Leave Entitlements:** Annual leave quotas per leave type (`SICK`, `CASUAL`, `ANNUAL`, `UNPAID`) with organization defaults and individual employee overrides.
- **Balance Ledger:** Transaction-backed balance ledger tracking allocated, used, pending, and available days with immutable history.
- **Application-Time Balance Awareness:** Leave modal displays available quotas and surfaces real-time warnings when requested days exceed enforced balances.
- **Multi-Tier Workflows:** Full lifecycle management (apply, approve, reject, cancel) with automatic ledger adjustments.

### 6. User & Role Administration
- **User Management View:** Dedicated administrative interface for managing platform user accounts.
- **Employee-User Linkage:** Connects user login accounts with organizational employee records.
- **Role Assignment:** Dynamic role promotion/demotion modal (`ADMIN`, `MANAGER`, `EMPLOYEE`) and account activation/deactivation controls.

---

## Technology Stack

### Backend
- **Framework:** [FastAPI](https://fastapi.tiangolo.com/) (0.115+) with [Uvicorn](https://www.uvicorn.org/) (ASGI server)
- **Data Validation & Settings:** [Pydantic v2](https://docs.pydantic.dev/) & `pydantic-settings`
- **ORM & Database Tooling:** [SQLAlchemy 2.0](https://www.sqlalchemy.org/) & [Alembic](https://alembic.sqlalchemy.org/) migrations
- **Database Driver:** `psycopg` (v3 binary driver for PostgreSQL)
- **Security & Cryptography:** `pwdlib` with [Argon2id](https://www.argon2.org/) password hashing, `PyJWT` (HS256 access tokens)
- **Testing:** [pytest](https://docs.pytest.org/), `pytest-asyncio`, and `httpx`

### Frontend
- **Framework & Language:** [React 19](https://react.dev/) & [TypeScript](https://www.typescriptlang.org/)
- **Build Tooling & Dev Server:** [Vite 8](https://vite.dev/)
- **Linter & Static Analysis:** [Oxlint](https://oxc.rs/docs/guide/usage/linter.html)
- **Testing:** [Vitest 5](https://vitest.dev/), [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/), `@testing-library/user-event`, and `jsdom`

### Database & Environment
- **Primary Database:** PostgreSQL 16+ (tested on PostgreSQL 18)
- **Operating Environment:** Windows PowerShell (primary development environment)

---

## Repository Structure

```text
MBiotrack-EMS/
├── .env.example                  # Canonical environment configuration template
├── .gitignore                    # Root exclusion rules (Python, Node, dumps, IDE)
├── README.md                     # Main project documentation
├── docs/
│   └── DEPLOYMENT.md             # Production deployment and architecture guide
├── backend/
│   ├── alembic.ini               # Alembic configuration
│   ├── pytest.ini                # Pytest configuration
│   ├── requirements.txt          # Production backend dependencies
│   ├── requirements-dev.txt      # Development and test dependencies
│   ├── alembic/
│   │   ├── env.py                # Migration runner script with model bindings
│   │   └── versions/             # Migration revisions (0001 through 0011)
│   ├── app/
│   │   ├── main.py               # FastAPI application factory, middleware, router mounts
│   │   ├── api/                  # API routers (auth, employees, attendance, leaves, etc.)
│   │   ├── cli/                  # Command-line tools (create_admin.py, update_admin_email.py)
│   │   ├── core/                 # Config (settings) and security (Argon2, JWT)
│   │   ├── db/                   # Database engine, session, and base model registry
│   │   ├── dependencies/         # FastAPI security dependencies (auth, roles)
│   │   ├── models/               # SQLAlchemy ORM models
│   │   ├── schemas/              # Pydantic request/response schemas
│   │   └── services/             # Business logic layer
│   └── tests/                    # 421 automated backend pytest tests
└── frontend/
    ├── .gitignore                # Frontend-specific ignore rules (dist, node_modules)
    ├── .oxlintrc.json            # Oxlint configuration
    ├── package.json              # Frontend scripts and dependencies
    ├── package-lock.json         # Lockfile
    ├── tsconfig.json             # Root TypeScript config
    ├── tsconfig.app.json         # Application TypeScript config
    ├── tsconfig.test.json        # Test suite TypeScript config
    ├── vite.config.ts            # Vite config with backend proxy (/api -> 8000)
    ├── vitest.config.ts          # Vitest runner configuration
    ├── src/
    │   ├── App.tsx               # Root application shell with role-based routing
    │   ├── api/                  # Fetch client and endpoint modules
    │   ├── components/           # UI components, modals, and views
    │   ├── context/              # AuthContext (in-memory token & session epoch)
    │   ├── test/                 # Test helpers, render utilities, and fixtures
    │   ├── types/                # TypeScript interface definitions
    │   └── utils/                # RBAC permission evaluation utilities
    └── public/                   # Static SVG assets and favicon
```

---

## Database Migrations Chain

MBiotrack-EMS uses an ordered, linear Alembic migration chain covering revisions `0001` through `0011`:

| Revision | File Name | Description |
|---|---|---|
| `0001` | `0001_initial_employee_table.py` | Initial employee model and base schema |
| `0002` | `0002_authentication_and_audit.py` | Users, Argon2id passwords, and audit log tables |
| `0003` | `0003_office_and_assignment_domain.py` | Offices, timezones, and employee office assignments |
| `0004` | `0004_device_registry.py` | Biometric terminal device registry and authentication |
| `0005` | `0005_audit_log_evolution.py` | Audit log schema enhancements and target tracking |
| `0006` | `0006_normalized_attendance_events.py` | Raw attendance punches and daily attendance aggregates |
| `0007` | `0007_leave_and_holiday_domain.py` | Leave requests, leave types, and holiday calendars |
| `0008` | `0008_attendance_reviews.py` | Attendance session reviews and supervisor approvals |
| `0009` | `0009_working_day_leave_calculation.py` | Working-day deduction calculation excluding holidays/weekends |
| `0010` | `0010_attendance_corrections.py` | Attendance punch correction requests and status workflows |
| `0011` | `0011_leave_entitlements_and_balances.py` | Leave entitlement quotas, balance ledger, and transaction logs |

To apply all migrations to the database:
```powershell
Set-Location backend
alembic upgrade head
Set-Location ..
```

---

## Prerequisites

Before setting up MBiotrack-EMS locally on Windows, ensure the following tools are installed:

1. **Python 3.12+** (verified through Python 3.14): Ensure Python and pip are available in your `PATH`.
2. **Node.js 20+ & npm** (verified on Node v26 and npm v11).
3. **PostgreSQL 16+** (tested on PostgreSQL 18): Running on `localhost:5432`.
4. **Git**: Configured for your development environment.

---

## Local Windows Development Setup

Follow these PowerShell steps from the project root (`C:\Users\<Username>\...\MBiotrack-EMS`):

### 1. Python Virtual Environment & Backend Dependencies

```powershell
# Create a dedicated virtual environment at repository root
python -m venv .venv

# Activate the virtual environment
.\.venv\Scripts\Activate.ps1

# Upgrade pip and install dependencies
python -m pip install --upgrade pip
pip install -r backend/requirements.txt
pip install -r backend/requirements-dev.txt
```

### 2. Environment Configuration

Copy the canonical template to create your local `.env`:

```powershell
Copy-Item .env.example .env
```

> [!IMPORTANT]
> Configure your local PostgreSQL database credentials in `.env`:
> ```ini
> DATABASE_URL=postgresql+psycopg://postgres:your_password@localhost:5432/mbiotrack_dev
> TEST_DATABASE_URL=postgresql+psycopg://postgres:your_password@localhost:5432/mbiotrack_test
> ```
> Never commit `.env` to version control. The file is actively ignored by `.gitignore`.

### 3. Database Creation & Migrations

Create development and test databases in PostgreSQL (using `psql` or pgAdmin):
```sql
CREATE DATABASE mbiotrack_dev;
CREATE DATABASE mbiotrack_test;
```

Run the Alembic migrations up to head from the `backend` directory:
```powershell
Set-Location backend
alembic upgrade head
Set-Location ..
```

### 4. Frontend Installation

From the project root:
```powershell
npm.cmd --prefix frontend install
```

### 5. Running the Application

Open two separate PowerShell terminal sessions:

**Terminal 1 — FastAPI Backend Server:**
```powershell
.\.venv\Scripts\Activate.ps1
Set-Location backend
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
- Interactive Swagger API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Health check: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)
- Readiness check: [http://127.0.0.1:8000/health/ready](http://127.0.0.1:8000/health/ready)

**Terminal 2 — React Frontend Dev Server:**
```powershell
npm.cmd --prefix frontend run dev
```
- Single-page application: [http://localhost:5173](http://localhost:5173) (Vite proxies `/api` calls directly to `127.0.0.1:8000`).

---

## Initial Administrator Setup (Bootstrap CLI)

MBiotrack-EMS includes command-line tools to bootstrap and manage the initial administrator account.

### 1. Initial Admin Bootstrap
From the `backend` directory (with virtual environment active):
```powershell
python -m app.cli.create_admin
```

- **Safety Checks:** Verifies target database is strictly local (`localhost:5432`), acquires a PostgreSQL transaction-scoped advisory lock, and ensures zero user records exist before creating the first `ADMIN`.
- **Credentials:** Prompts for administrator name, valid email, and masked password (minimum 12 characters, hashed with Argon2id).
- **Audit Logging:** Records an `AUTH_ADMIN_BOOTSTRAP` event in `audit_logs`.

### 2. Administrator Email Update Utility
```powershell
python -m app.cli.update_admin_email
```
- Allows updating the primary administrator email address securely from the local console with transactional audit trail recording.

---

## API & Role-Based Access Control (RBAC) Overview

### Key API Routes

| Domain | Method | Endpoint | Authorized Roles | Description |
|---|---|---|---|---|
| **Auth** | `POST` | `/api/v1/auth/login` | Public | Authenticates credentials, rate limits IP, returns 15-min JWT |
| | `GET` | `/api/v1/auth/me` | Authenticated | Resolves active user profile and linked employee data |
| | `POST` | `/api/v1/auth/logout` | Authenticated | Stateless logout instruction |
| **Users** | `GET` | `/api/v1/users` | `ADMIN` | Lists system user accounts |
| | `PATCH` | `/api/v1/users/{id}/role` | `ADMIN` | Updates user role (`ADMIN`, `MANAGER`, `EMPLOYEE`) |
| | `PATCH` | `/api/v1/users/{id}/activate` | `ADMIN` | Activates or deactivates user account |
| **Employees** | `GET` | `/api/v1/employees` | `ADMIN`, `MANAGER` | Lists employee directory |
| | `POST` | `/api/v1/employees` | `ADMIN`, `MANAGER` | Registers new employee record |
| | `GET` | `/api/v1/employees/{id}` | `ADMIN`, `MANAGER`, `EMPLOYEE` | View employee; `EMPLOYEE` restricted to own record |
| | `PATCH` | `/api/v1/employees/{id}` | `ADMIN`, `MANAGER`, `EMPLOYEE` | Update employee; `EMPLOYEE` restricted to self-service fields |
| | `DELETE` | `/api/v1/employees/{id}` | `ADMIN` | Soft-deletes employee record |
| **Offices** | `GET`, `POST` | `/api/v1/offices` | `ADMIN` | Manage organizational offices and timezones |
| **Devices** | `GET`, `POST` | `/api/v1/devices` | `ADMIN` | Manage registered biometric terminals |
| **Assignments** | `GET`, `POST` | `/api/v1/assignments` | `ADMIN` | Manage employee office assignments |
| **Attendance** | `POST` | `/api/v1/attendance/ingest` | `ADMIN`, `DEVICE` | Ingest raw punch events from biometric devices |
| | `POST` | `/api/v1/attendance/punch` | Authenticated | Manual web punch (`CHECK_IN`, `CHECK_OUT`) |
| | `GET` | `/api/v1/attendance/daily` | `ADMIN`, `MANAGER`, `EMPLOYEE` | View daily aggregated attendance records |
| | `GET` | `/api/v1/attendance/report` | `ADMIN`, `MANAGER`, `EMPLOYEE` | Attendance reports with department filtering & worked duration |
| | `GET` | `/api/v1/attendance/report/export-csv` | `ADMIN`, `MANAGER` | Export filtered attendance reports as CSV |
| | `POST` | `/api/v1/attendance/corrections` | Authenticated | Submit attendance punch correction request |
| | `PATCH` | `/api/v1/attendance/corrections/{id}/review` | `ADMIN`, `MANAGER` | Approve or reject attendance correction request |
| **Leaves** | `GET`, `POST` | `/api/v1/leaves` | Authenticated | View and submit leave requests |
| | `PATCH` | `/api/v1/leaves/{id}/approve` | `ADMIN`, `MANAGER` | Approve pending leave request |
| | `PATCH` | `/api/v1/leaves/{id}/reject` | `ADMIN`, `MANAGER` | Reject pending leave request |
| | `GET` | `/api/v1/leaves/entitlements` | `ADMIN`, `MANAGER`, `EMPLOYEE` | View leave entitlement quotas and defaults |
| | `GET` | `/api/v1/leaves/ledger` | `ADMIN`, `MANAGER`, `EMPLOYEE` | View leave balance ledger and transaction history |
| **Holidays** | `GET`, `POST` | `/api/v1/holidays` | `ADMIN` (write), Authenticated (read) | Manage organizational holiday calendar |
| **Audit** | `GET` | `/api/v1/audit-logs` | `ADMIN` | View immutable audit trail events |
| **Health** | `GET` | `/health`, `/health/ready` | Public | Liveness and database readiness probes |

### Role Hierarchy & Responsibilities

1. **ADMIN (Administrator):** Full organizational access across all modules (user management, roles, device registration, offices, audit logs, employee directory, leave and attendance approvals).
2. **MANAGER (Department Manager):** Manages team operations within their assigned department. Can view directory, approve department leaves and attendance corrections, access department attendance reports, and perform web punches. Restricted from accessing other departments or mutating administrative configurations.
3. **EMPLOYEE (Staff Member):** Self-service capabilities. Can view own profile, record web punches, view personal attendance and leave history, submit leave requests and punch corrections, and inspect personal leave balance ledgers.

---

## Automated Testing & Quality Checks

The codebase is thoroughly tested and verified across both backend and frontend suites.

### 1. Backend Test Suite (pytest)
Runs **421 automated tests** covering authentication, RBAC dependencies, employee services, office domains, device registries, attendance ingestion, daily attendance operations, attendance corrections, reports, working-day leave calculations, and leave balance ledgers:
```powershell
Set-Location backend
..\.venv\Scripts\python.exe -m pytest -v
Set-Location ..
```
*Verification status: `421 passed`*

### 2. Frontend Test Suite (Vitest)
Runs **410 automated tests** across **37 test files** covering UI components, modals, permission hooks, API clients, balance ledgers, and attendance views:
```powershell
npm.cmd --prefix frontend run test:run
```
*Verification status: `37 passed (37 test files), 410 passed (410 tests)`*

### 3. Frontend TypeScript Typecheck
Validates strict TypeScript types across the entire frontend application and test files:
```powershell
npm.cmd --prefix frontend run test:typecheck
```
*Verification status: Passed with zero type errors.*

### 4. Frontend Linter (Oxlint)
High-performance linting for syntax correctness, React best practices, and code cleanliness:
```powershell
npm.cmd --prefix frontend run lint
```
*Verification status: `0 warnings and 0 errors`*

### 5. Frontend Production Build
Compiles optimized, minified production assets using Vite:
```powershell
npm.cmd --prefix frontend run build
```
*Verification status: Production bundle compiled successfully into `frontend/dist/`.*

---

## Project Status & Roadmap

### Implemented Features (Verified MVP)
- [x] Multi-tier PostgreSQL schema with 11 linear Alembic migrations (`0001` through `0011`).
- [x] Argon2id password hashing and in-memory JWT authentication.
- [x] IP rate limiting on login attempts with sliding-window evaluation.
- [x] Day-0 system administrator bootstrap CLI with PostgreSQL advisory locks.
- [x] Full RBAC employee directory with search and department filtering.
- [x] Office domain management with timezone awareness and employee office assignments.
- [x] Biometric device registry with device authentication keys and status tracking.
- [x] Raw attendance punch ingestion and paired check-in/check-out duration calculation.
- [x] Manager attendance review workflows and attendance punch correction system.
- [x] Attendance reporting with date range, office, employee, and department filtering with CSV export.
- [x] Working-day leave calculation taking into account weekends and public holidays.
- [x] Annual leave entitlements with default quotas and individual overrides.
- [x] Leave balance ledger tracking allocated, used, pending, and available days with audit history.
- [x] User administration view with role assignment (`ADMIN`, `MANAGER`, `EMPLOYEE`) and account activation.
- [x] Comprehensive test coverage with 421 backend tests and 410 frontend tests (37 test files).

### Planned Features (Future Milestones)
- [ ] **Physical Hardware Driver Integration:** Testing and driver certification with physical fingerprint and facial recognition biometric hardware models.
- [ ] **Hardware Push-Protocol Listeners:** Direct listener daemons for proprietary biometric terminal HTTP/TCP push protocols.
- [ ] **Advanced Shift Scheduling:** Dynamic shifts, rotating schedules, and automated overtime policy calculations.
- [ ] **Production Infrastructure Handover:** Formal reverse proxy deployment (Nginx/Caddy) and external TLS termination (see [docs/DEPLOYMENT.md](file:///C:/Users/NAGARAJ/.vscode/MBiotrack-EMS/docs/DEPLOYMENT.md)).
