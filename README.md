# MBiotrack-EMS
**Employee Management System with Biometric Attendance Tracking**

MBiotrack-EMS is a role-based employee management system designed for organizational workforce tracking. It provides a FastAPI backend and a React single-page application (SPA) with role-based access control (RBAC), Argon2id password hashing, in-memory JWT authentication, and atomic audit logging.

> [!NOTE]
> **Project Scope & Roadmap Notice:**
> The employee management foundation, role-based authorization, self-service UI, audit logging, and automated testing suites are **fully implemented and verified**.
> Physical biometric hardware capture (fingerprint/facial scanning) is **planned for future milestones** pending physical device selection and SDK specification. No hardware device is currently claimed as supported.

---

## Table of Contents
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Local Windows Development Setup](#local-windows-development-setup)
- [Initial Administrator Setup (Bootstrap CLI)](#initial-administrator-setup-bootstrap-cli)
- [API & Role-Based Access Control Overview](#api--role-based-access-control-overview)
- [Automated Testing & Quality Checks](#automated-testing--quality-checks)
- [Project Status & Roadmap](#project-status--roadmap)

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
│   │   └── versions/             # Migration revisions (0001, 0002)
│   ├── app/
│   │   ├── main.py               # FastAPI application factory and router mounts
│   │   ├── api/                  # API endpoints (/auth, /employees)
│   │   ├── cli/                  # Command-line tools (create_admin.py)
│   │   ├── core/                 # Config (settings) and security (Argon2, JWT)
│   │   ├── db/                   # Database engine, session, and base registry
│   │   ├── dependencies/         # FastAPI security dependencies (auth, roles)
│   │   ├── models/               # SQLAlchemy ORM models (User, Employee, AuditLog)
│   │   ├── schemas/              # Pydantic schemas (auth, employee)
│   │   └── services/             # Business logic (AuthService, EmployeeService)
│   └── tests/                    # 120 automated backend pytest suites
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
    │   ├── components/           # UI components (Login, Table, Modals, Profile)
    │   ├── context/              # AuthContext (in-memory token & session epoch)
    │   ├── test/                 # Test helpers, render utilities, and fixtures
    │   ├── types/                # TypeScript interface definitions
    │   └── utils/                # RBAC permission evaluation utilities
    └── public/                   # Static SVG assets and favicon
```

---

## Prerequisites

Before setting up MBiotrack-EMS locally, ensure the following are installed:

1. **Python 3.12+** (verified through Python 3.14): Ensure Python and pip are available in your `PATH`.
2. **Node.js 20+ & npm** (verified on Node v26 and npm v11).
3. **PostgreSQL 16+** (tested on PostgreSQL 18): Running locally on port `5432`.
4. **Git**: Configured for your development environment.

---

## Local Windows Development Setup

Follow these PowerShell steps from the project root (`C:\Users\<Username>\...\MBiotrack-EMS`):

### 1. Python Virtual Environment & Backend Dependencies

```powershell
# Create a dedicated virtual environment at the repository root
python -m venv .venv

# Activate the virtual environment
.\.venv\Scripts\Activate.ps1

# Upgrade pip and install backend requirements
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
> Edit `.env` to configure your local PostgreSQL database credentials:
> ```ini
> DATABASE_URL=postgresql+psycopg://postgres:your_password@localhost:5432/mbiotrack_dev
> TEST_DATABASE_URL=postgresql+psycopg://postgres:your_password@localhost:5432/mbiotrack_test
> ```
> Never commit `.env` to version control. The file is actively ignored by `.gitignore`.

### 3. Database Creation & Migrations

Create the development and test databases in PostgreSQL (using `psql` or pgAdmin):
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

**Terminal 2 — React Frontend Dev Server:**
```powershell
npm.cmd --prefix frontend run dev
```
- Single-page application: [http://localhost:5173](http://localhost:5173) (Vite proxies `/api` calls directly to `127.0.0.1:8000`).

---

## Initial Administrator Setup (Bootstrap CLI)

MBiotrack-EMS includes an interactive command-line interface (CLI) to bootstrap the initial system administrator account during day-0 deployment.

### Execution Command

From the `backend` directory (with your virtual environment active):
```powershell
python -m app.cli.create_admin
```

### Prerequisites
1. PostgreSQL 18 is running on `localhost:5432`.
2. Database schema is migrated up to revision `0002_authentication_and_audit` via `alembic upgrade head`.
3. `DATABASE_URL` is configured in `.env` targeting the local development database:
   ```ini
   DATABASE_URL=postgresql+psycopg://postgres:<password>@localhost:5432/mbiotrack_dev
   ```

### Operational Rules & Safety Restrictions
- **Strictly Local Target:** The CLI verifies that `DATABASE_URL` targets the local development database `mbiotrack_dev` on loopback host (`localhost` or `127.0.0.1`) and port `5432`. It unconditionally rejects test databases (`mbiotrack_test`), production configurations, remote hosts, and unexpected ports.
- **Strictly One-Time Bootstrap:** The CLI refuses execution if **any** user account already exists in the database, regardless of role (`ADMIN`, `MANAGER`, `EMPLOYEE`) or active status (`is_active=True` or `False`).
- **Input Credentials:**
  - Full Name: Non-empty string, maximum 150 characters.
  - Email Address: Practical regex format validation, stored in normalized lowercase.
  - Password: Input masked via `getpass`, minimum 12 characters, confirmed twice, and hashed with Argon2id.
- **Audit Logging:** Every bootstrap execution atomically records an `AUTH_ADMIN_BOOTSTRAP` event in `audit_logs` within the same database transaction.
- **Concurrency & Deadlock Prevention:** Uses PostgreSQL transaction-scoped advisory locks to ensure that simultaneous executions serialize cleanly; exactly one bootstrap operation can ever succeed on an empty database.

### Account Recovery
The bootstrap CLI is strictly for day-0 initial account creation and cannot be used to reset passwords or create additional administrators. Once an initial account exists, subsequent administration must occur through authorized application workflows or controlled database restoration procedures from verified backups.

---

## API & Role-Based Access Control Overview

### Verified Endpoints

| Method | Endpoint | Authorized Roles | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | Public | Authenticates credentials, checks IP rate limits, returns 15-min JWT |
| `GET` | `/api/v1/auth/me` | Authenticated | Resolves current active user profile from PostgreSQL (excludes password hash) |
| `POST` | `/api/v1/auth/logout` | Authenticated | Stateless logout instruction to discard memory token |
| `GET` | `/api/v1/employees` | `ADMIN`, `MANAGER` | Lists all active non-deleted employee records |
| `POST` | `/api/v1/employees` | `ADMIN`, `MANAGER` | Creates a new employee with unique code and email validation |
| `GET` | `/api/v1/employees/{id}` | `ADMIN`, `MANAGER`, `EMPLOYEE` | View employee; `EMPLOYEE` may only view their own linked record |
| `PATCH` | `/api/v1/employees/{id}` | `ADMIN`, `MANAGER`, `EMPLOYEE` | Update employee; `EMPLOYEE` restricted to own `first_name` and `last_name` |
| `DELETE` | `/api/v1/employees/{id}` | `ADMIN` only | Soft-deletes employee (`is_active=False`, `deleted_at=now()`, audit logged) |
| `GET` | `/health` | Public | Application health status check |

### Role Hierarchy & Responsibilities

1. **ADMIN (Administrator):**
   - Full organizational management.
   - Can create, view, edit all employee fields, and soft-delete employees.
   - Access to audit trail records.
2. **MANAGER (Department Manager):**
   - Can view company directory, search, filter by department, and create new employees.
   - Can update employee operational details.
   - Forbidden from deactivating or deleting employees (`is_active=False` returns 403 Forbidden).
3. **EMPLOYEE (Staff Member):**
   - Cannot view company-wide directory or list other employees.
   - Restricted to a personal self-service profile card view (`EmployeeProfileView`).
   - May only edit their own `first_name` and `last_name` (`ProfileEditModal`). Any attempt to alter department, designation, email, or status is rejected with 403 Forbidden.

> [!IMPORTANT]
> **Backend Authorization is Authoritative:**
> While frontend navigation and modals adapt dynamically to the user's role, every API endpoint enforces strict independent authorization checks via FastAPI dependencies (`require_role`, `get_current_user`). Frontend UI constraints are never trusted as security boundaries.

---

## Automated Testing & Quality Checks

The repository contains 239 total automated tests across backend and frontend suites.

### Backend Tests (pytest)
Runs 120 automated tests covering models, Argon2id hashing, PyJWT, authentication endpoints, role dependencies, rate limiting, and bootstrap CLI safety:
```powershell
Set-Location backend
..\.venv\Scripts\python.exe -m pytest -v
Set-Location ..
```
*Expected output: `120 passed`*

### Frontend Tests (Vitest)
Runs 119 automated tests covering permissions, API client, in-memory token handling, UI components, role switches, and session race conditions:
```powershell
npm.cmd --prefix frontend run test:run
```
*Expected output: `13 passed (13 test files), 119 passed (119 tests)`*

### Frontend TypeScript Typecheck
```powershell
npm.cmd --prefix frontend run test:typecheck
```

### Frontend Linter (Oxlint)
```powershell
npm.cmd --prefix frontend run lint
```
*Expected output: `0 warnings and 0 errors`*

### Frontend Production Build
```powershell
npm.cmd --prefix frontend run build
```
*Expected output: Production bundle compiled into `frontend/dist/`*

---

## Project Status & Roadmap

### Implemented Features (Verified)
- [x] Multi-tier PostgreSQL schema with Alembic migration chain (0001 $\rightarrow$ 0002).
- [x] Argon2id password hashing with timing attack mitigation.
- [x] In-memory JWT access token management (no local storage leakage).
- [x] Atomic IP rate limiting on authentication attempts.
- [x] Day-0 system administrator bootstrap CLI with PostgreSQL advisory locks.
- [x] Full RBAC employee directory with search and department filtering.
- [x] Employee self-service profile card view with restricted field edits.
- [x] Soft deletion with immutable audit logging.
- [x] Multi-request session epoch tracking to prevent asynchronous race conditions.
- [x] 100% automated test coverage across 239 backend and frontend tests.

### Planned Features (Future Milestones)
- [ ] **Biometric Hardware Selection & Driver Architecture:** Evaluation of physical attendance hardware models, transport protocol (Push HTTP/TCP), and template formats.
- [ ] **Biometric Attendance Event Schemas:** Ingestion of real-time attendance punches and device telemetry.
- [ ] **Shift Scheduling & Attendance Policies:** Overtime calculation, leave approval workflows, and timecard reconciliations.
- [ ] **Production Infrastructure Handover:** Formal reverse proxy deployment (Nginx/Caddy) and external TLS termination (see [docs/DEPLOYMENT.md](file:///C:/Users/NAGARAJ/.vscode/MBiotrack-EMS/docs/DEPLOYMENT.md)).
