# MBiotrack-EMS
Employee Management System with Biometric Attendance Tracking

## Initial Administrator Setup

MBiotrack-EMS includes an interactive command-line interface (CLI) to bootstrap the initial system administrator account during day-0 deployment.

### Execution Command

From the `backend` directory:
```bash
python -m app.cli.create_admin
```

### Prerequisites
1. PostgreSQL 18 is running on `localhost:5432`.
2. Database schema is migrated up to revision `0002_authentication_and_audit` via `alembic upgrade head`.
3. `DATABASE_URL` is configured in `.env` targeting the local development database:
   ```
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
