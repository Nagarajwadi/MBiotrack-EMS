# MBiotrack-EMS — Production Deployment Guide

This document outlines the architecture, security configurations, and deployment procedures required to transition **MBiotrack-EMS** from a local development environment to a secure production environment.

> [!NOTE]
> **Deployment Status Notice:**
> The application code, database schema migrations, and automated test suites are fully implemented and verified.
> This document serves as a **deployment preparation guide**. Production hosting infrastructure (such as dedicated web servers, DNS records, TLS certificates, and process managers) has **not yet been provisioned**.

---

## A. Production Architecture

In production, MBiotrack-EMS operates behind an external HTTPS reverse proxy that terminates TLS and dispatches client requests to the appropriate application tier:

```text
                                  +---------------------------------------+
                                  |         Client Web Browser            |
                                  +---------------------------------------+
                                                     |
                                                     | HTTPS (Port 443)
                                                     v
                                  +---------------------------------------+
                                  |    HTTPS Reverse Proxy (Nginx/Caddy)  |
                                  |    - TLS Termination                  |
                                  |    - Security Headers                 |
                                  +---------------------------------------+
                                         /                         \
                          Static Assets /                           \ API Requests (/api/*)
                                       v                             v
           +---------------------------------------+     +---------------------------------------+
           |     React Static Bundle (dist/)       |     |      FastAPI Backend (Uvicorn)        |
           |     - Single-Page Application (SPA)   |     |      - Listening on 127.0.0.1:8000    |
           |     - HTML5 PushState Fallback        |     |      - Multi-worker ASGI supervisor   |
           +---------------------------------------+     +---------------------------------------+
                                                                             |
                                                                             | Encrypted TCP (Port 5432)
                                                                             | sslmode=require / verify-full
                                                                             v
                                                         +---------------------------------------+
                                                         |      PostgreSQL Database Server       |
                                                         |      - Dedicated service user         |
                                                         |      - Multi-layer firewall / VPC     |
                                                         +---------------------------------------+
```

### Component Status Matrix

| Component | Repository Status | Operational Responsibility |
|---|---|---|
| **FastAPI Backend Application** | Implemented & verified | Python runtime & environment configuration |
| **Database Migrations (Alembic)** | Implemented (`0001` & `0002`) | Execute `alembic upgrade head` on production DB |
| **React Single-Page Application** | Implemented & verified | Compile via `npm run build` and serve `dist/` |
| **Reverse Proxy (Nginx / Caddy)** | Not yet provisioned | Provision host, configure TLS and routing rules |
| **PostgreSQL Database Server** | Local dev verified | Provision production database with TLS and automated backups |
| **Biometric Attendance Hardware** | Future milestone | Device model selection, SDK integration, and event ingestion |

---

## B. Production Environment Configuration

The backend application resolves its settings via `pydantic-settings` from environment variables. In production, variables should be injected by the process supervisor or a secure secrets manager rather than committing a `.env` file.

### Required Production Environment Variables

| Variable | Recommended Production Setting | Description & Security Requirements |
|---|---|---|
| `ENVIRONMENT` | `production` | Enables strict production validation guards in `config.py` |
| `DEBUG` | `false` | Disables debug logs and detailed error tracebacks |
| `PROJECT_NAME` | `MBiotrack-EMS` | Application identifier |
| `HOST` | `127.0.0.1` | Bind strictly to loopback interface behind the reverse proxy |
| `PORT` | `8000` | Local port for FastAPI Uvicorn workers |
| `CORS_ORIGINS` | `["https://mbiotrack.yourdomain.com"]` | JSON array containing only authorized production domains (no wildcards) |
| `DATABASE_URL` | `postgresql+psycopg://user:pass@db-host:5432/mbiotrack_prod?sslmode=require` | Connection string targeting the production database with TLS enforced |
| `SECRET_KEY` | High-entropy random string (64+ chars) | Cryptographic key for HS256 JWT access tokens. Must be generated randomly |
| `ALGORITHM` | `HS256` | Cryptographic algorithm; hard-coded to `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Lifetime of in-memory access tokens (default: 15 minutes) |
| `TOKEN_ISSUER` | `mbiotrack-ems` | Validated in token decoding options |
| `AUDIT_HMAC_SECRET` | Distinct random string (64+ chars) | Separate HMAC secret for audit pseudonymization (must not equal `SECRET_KEY`) |
| `TRUST_PROXY_HEADERS` | `true` | Enables `X-Forwarded-For` parsing through trusted proxies |
| `TRUSTED_PROXIES` | `["127.0.0.1", "10.0.0.0/8"]` | Explicit CIDR list of upstream reverse proxies |

### Cryptographic Key Generation
Generate production secrets using cryptographically secure random utilities:
```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

> [!WARNING]
> **Production Guard:** If `ENVIRONMENT=production` and `SECRET_KEY` is under 32 characters or matches the development placeholder (`dev-insecure-secret-key-change-in-production-min-32-chars`), FastAPI will intentionally refuse to start.

---

## C. Database Security & Migrations

### 1. Dedicated Credentials & Least Privilege
- Never connect the application using the `postgres` superuser account.
- Provision a dedicated PostgreSQL role with ownership restricted to the `mbiotrack_prod` schema:
  ```sql
  CREATE USER mbiotrack_app WITH PASSWORD '<strong-password>';
  GRANT CONNECT ON DATABASE mbiotrack_prod TO mbiotrack_app;
  GRANT USAGE, CREATE ON SCHEMA public TO mbiotrack_app;
  ```

### 2. TLS Connection Enforcement
- When connecting across networks or cloud providers, append `?sslmode=require` or `?sslmode=verify-full` to `DATABASE_URL`.
- Provide the CA certificate path if using custom certificate authorities.

### 3. Running Migrations in Production
Before starting the backend service, apply Alembic migrations from the `backend/` directory:
```bash
alembic upgrade head
```
Always verify current revision status prior to migration:
```bash
alembic current
```

### 4. Backup & Restore Planning
- Automated daily backups must be scheduled via `pg_dump` with custom directory format:
  ```bash
  pg_dump -Fc -h db-host -U mbiotrack_app mbiotrack_prod > mbiotrack_prod_$(date +%Y%m%d).dump
  ```
- Regularly verify that backups can be restored into an isolated staging database before performing major version upgrades.

---

## D. Reverse Proxy Configuration

A reverse proxy (such as **Nginx** or **Caddy**) is required to handle TLS termination, enforce HTTP security headers, serve static frontend assets, and route API traffic to the FastAPI backend.

### Key Reverse Proxy Responsibilities
1. **Route Routing:**
   - Route `/api/*` and `/health` requests to `http://127.0.0.1:8000`.
   - Route all other requests (`/*`) to the React application bundle in `frontend/dist/`.
   - Implement HTML5 History API fallback: return `dist/index.html` for unknown paths so React client routing functions properly.
2. **Proxy Headers:**
   - Set `X-Forwarded-For $proxy_add_x_forwarded_for;`
   - Set `X-Forwarded-Proto $scheme;`
   - Set `X-Forwarded-Host $host;`
3. **Security Headers:**
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Referrer-Policy: strict-origin-when-cross-origin`

### Illustrative Nginx Configuration Reference
```nginx
server {
    listen 80;
    server_name mbiotrack.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name mbiotrack.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/mbiotrack.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mbiotrack.yourdomain.com/privkey.pem;

    # Static Frontend Assets
    root /var/www/mbiotrack/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API Routing to FastAPI Backend
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        proxy_pass http://127.0.0.1:8000/health;
        proxy_set_header Host $host;
    }
}
```

---

## E. Frontend Production Deployment

In development, Vite proxies API calls directly. In production, Vite is not used as a server; the frontend is compiled into optimized static HTML, CSS, and JavaScript.

### 1. Build Static Assets
From the repository root:
```bash
npm.cmd --prefix frontend run build
```
This produces the distribution directory: `frontend/dist/`.

### 2. Verify Output Bundle
Ensure the output directory contains `index.html` and versioned assets in `assets/`. Transfer the contents of `frontend/dist/` to your web server document root (e.g., `/var/www/mbiotrack/frontend/dist`).

---

## F. Backend Application Hosting & Supervision

### 1. Process Supervision (systemd)
In production Linux environments, manage the FastAPI Uvicorn process using systemd or a container manager to guarantee automatic restarts:

```ini
[Unit]
Description=MBiotrack-EMS FastAPI Backend
After=network.target postgresql.service

[Service]
Type=simple
User=mbiotrack
WorkingDirectory=/opt/mbiotrack/backend
ExecStart=/opt/mbiotrack/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 4
Restart=always
RestartSec=5
EnvironmentFile=/etc/mbiotrack/production.env

[Install]
WantedBy=multi-user.target
```

### 2. Worker Concurrency
Run Uvicorn with standard production multi-worker configuration:
$$\text{Workers} = (2 \times \text{CPU cores}) + 1$$
Ensure connection pool settings in `backend/app/core/config.py` (`DB_POOL_SIZE=5`, `DB_MAX_OVERFLOW=10`) align with your database maximum connection limit ($(\text{Pool Size} + \text{Overflow}) \times \text{Workers} \le \text{PostgreSQL max\_connections}$).

### 3. Health Monitoring
Automated monitoring systems should regularly probe the lightweight health check:
- Endpoint: `GET /health`
- Expected response: `{"status": "ok", "application": "MBiotrack-EMS"}` (HTTP 200)

---

## G. Pre-Deployment Security Checklist

Before directing live user traffic to MBiotrack-EMS, verify each checklist item:

- [ ] **Cryptographic Secrets:** `SECRET_KEY` and `AUDIT_HMAC_SECRET` are high-entropy random values and distinct from each other.
- [ ] **Environment Guard:** `ENVIRONMENT=production` and `DEBUG=false` are verified.
- [ ] **CORS Allowlist:** `CORS_ORIGINS` contains only the verified production frontend URL.
- [ ] **Database Network Isolation:** PostgreSQL is not accessible from the public internet. Connections require valid TLS (`sslmode=require`).
- [ ] **Database Migrations:** Schema is up to date (`alembic upgrade head`).
- [ ] **Initial Administrator Creation:** Bootstrap CLI (`create_admin.py`) was executed over local shell to initialize day-0 administrator credentials.
- [ ] **Trusted Proxy Integrity:** `TRUST_PROXY_HEADERS=true` with `TRUSTED_PROXIES` restricted to the exact IP/CIDR of the reverse proxy.
- [ ] **HTTPS Enforcement:** All HTTP traffic redirects to HTTPS with HSTS enabled.
- [ ] **Audit Log Verification:** Database table `audit_logs` correctly records login successes, failures, and employee modifications.
- [ ] **Backup Retention:** Scheduled daily database dump rotation is active and tested.

---

## H. Biometric Feature Separation Notice

Biometric attendance devices (fingerprint scanners, facial recognition terminals) require physical device procurement, firmware validation, and protocol specification. 

**Current Architecture:**
The current release provides all administrative, authorization, and employee directory foundations necessary to support attendance tracking. The biometric ingestion pipelines, attendance reconciliation engines, and hardware SDK integration will be developed in a subsequent dedicated milestone.

