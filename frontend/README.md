# MBiotrack-EMS — Frontend Application

This directory contains the single-page application (SPA) for **MBiotrack-EMS**, built with **React 19**, **TypeScript**, and **Vite**.

The client provides role-tailored user interfaces for organizational workforce administration:
- **Administrators (`ADMIN`)**: Full employee management, creation, updates, and soft-deletion.
- **Managers (`MANAGER`)**: Directory inspection, search, department filtering, and employee record creation/updates.
- **Staff Employees (`EMPLOYEE`)**: Dedicated self-service profile card view with restricted name editing.

> [!NOTE]
> **Biometric Feature Notice:**
> Biometric attendance hardware interactions (e.g. fingerprint enrollment or device punch feeds) are planned for subsequent milestones. No biometric scanning features are implemented in this frontend build.

---

## Architectural Highlights

### 1. In-Memory Token Management
Access tokens are handled with strict memory isolation:
- Tokens are stored exclusively in React state and a synchronous ref (`tokenRef.current`) inside `AuthContext.tsx`.
- **Zero Local Persistence:** Tokens are never written to `localStorage`, `sessionStorage`, or browser cookies. Closing or refreshing the tab clears authentication state by design.

### 2. Session Epoch & Race-Condition Safeguards
To prevent stale asynchronous network responses from polluting the UI across fast user interactions or rapid account switching:
- `AuthContext` maintains a monotonically increasing `sessionEpoch` integer.
- The fetch client (`api/client.ts`) attaches `requestEpoch` to in-flight requests.
- Responses returning after a user logs out or switches accounts are detected as obsolete (`requestEpoch !== sessionEpochRef.current`) and discarded.
- Stale 401 Unauthorized responses originating from an older session cannot evict a newer active session.

### 3. Separation of Responsibilities & Authoritative Backend
- Role evaluation utilities in `src/utils/permissions.ts` dynamically adapt UI controls (hiding/showing buttons, switching between the employee directory and personal profile).
- **Backend Authoritative Enforcement:** Frontend checks are strictly UX conveniences. The FastAPI backend independently checks every incoming request with database-backed role dependencies (`require_role`, `get_current_user`).

---

## Directory Structure

```text
frontend/
├── .gitignore                    # Excludes dist/, node_modules/, .oxlint_cache/
├── .oxlintrc.json                # Oxlint rules configuration
├── package.json                  # Scripts and dependencies
├── package-lock.json             # Deterministic package tree lockfile
├── index.html                    # SPA HTML entry point
├── vite.config.ts                # Bundler config and backend dev proxy
├── vitest.config.ts              # Vitest runner with jsdom setup
├── tsconfig.json                 # Base TypeScript configuration
├── tsconfig.app.json             # Production app TypeScript project
├── tsconfig.node.json            # Node/build tooling TypeScript project
├── tsconfig.test.json            # Test suite TypeScript project
├── public/                       # Static SVGs and favicon
└── src/
    ├── main.tsx                  # React DOM root render
    ├── App.tsx                   # Top-level shell & role-based view orchestration
    ├── App.css                   # Core application layout and theme
    ├── index.css                 # Global CSS reset
    ├── api/
    │   ├── apiError.ts           # Standardized ApiError class & retry handling
    │   ├── client.ts             # Fetch wrapper with JWT injection & 401 callback
    │   ├── authApi.ts            # /api/v1/auth endpoints (login, me, logout)
    │   └── employeeApi.ts        # /api/v1/employees REST endpoints
    ├── components/
    │   ├── components.css        # Modular styles (modals, forms, badges, tables)
    │   ├── index.ts              # Component barrel export
    │   ├── Header.tsx            # Navigation bar with user badge and logout
    │   ├── LoginForm.tsx         # Accessible login form with rate-limit countdown
    │   ├── EmployeeTable.tsx     # Directory roster with search & department filters
    │   ├── EmployeeModal.tsx     # Create / Edit employee modal
    │   ├── DeleteModal.tsx       # Soft-delete confirmation dialog
    │   ├── EmployeeProfileView.tsx # Self-service card view for EMPLOYEE role
    │   └── ProfileEditModal.tsx  # Restricted name-update modal for self-service
    ├── context/
    │   ├── authContextDef.ts     # AuthContext definition & TypeScript interface
    │   ├── AuthContext.tsx       # AuthProvider implementation & state management
    │   └── useAuth.ts            # Custom hook for consuming AuthContext
    ├── types/
    │   ├── auth.ts               # User, Token, Role, and Session types
    │   └── employee.ts           # Employee, CreatePayload, UpdatePayload types
    ├── utils/
    │   └── permissions.ts        # Pure RBAC permission calculation functions
    └── test/
        ├── setup.ts              # Global test setup & @testing-library/jest-dom
        ├── renderUtils.tsx       # Custom render helper with wrapped AuthProvider
        ├── fixtures/             # Mock data (authFixtures, employeeFixtures)
        └── integration/          # Session expiration & race condition test suites
```

---

## Development Setup

### 1. Install Dependencies
From the repository root:
```powershell
npm.cmd --prefix frontend install
```
Or directly from the `frontend/` directory:
```powershell
Set-Location frontend
npm.cmd install
```

### 2. Start Vite Development Server
```powershell
npm.cmd run dev
```
- Local URL: [http://localhost:5173](http://localhost:5173)
- **Vite Proxy:** The development server automatically proxies `/api` and `/health` requests to `http://127.0.0.1:8000` (the FastAPI backend). Ensure the backend service is running before signing in.

---

## Quality & Test Commands

All test and verification commands can be run directly from the `frontend/` directory:

### Run Automated Tests (Vitest)
Executes all 119 unit, component, and integration tests across 13 test files:
```powershell
npm.cmd run test:run
```
*Expected output: `13 passed (13 test files), 119 passed (119 tests)`*

### Watch Mode Testing
```powershell
npm.cmd run test
```

### TypeScript Type Checking
Validates the test suite against `tsconfig.test.json` without emitting output:
```powershell
npm.cmd run test:typecheck
```

### Static Analysis (Oxlint)
Performs fast linting across all TypeScript and React files:
```powershell
npm.cmd run lint
```
*Expected output: `Found 0 warnings and 0 errors.`*

### Production Build
Executes `tsc -b` for production TypeScript validation and compiles static bundle to `dist/`:
```powershell
npm.cmd run build
```
- Output bundle: `frontend/dist/` (ignored by Git).
- Test production bundle locally: `npm.cmd run preview`.
