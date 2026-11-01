from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.core.security import create_access_token, hash_password
from app.models.employee import Employee
from app.models.user import User

SAMPLE_EMPLOYEE = {
    "employee_code": "EMP001",
    "first_name": "John",
    "last_name": "Doe",
    "email": "john.doe@example.com",
    "department": "Engineering",
    "designation": "Software Engineer",
    "joining_date": "2026-01-15",
    "is_active": True,
}


@pytest.fixture(autouse=True)
def authenticate_as_admin(client, db_session):
    """Authenticate client as an active ADMIN user for employee regression tests."""
    admin = User(
        full_name="Regression Admin",
        email="regression_admin@example.com",
        password_hash=hash_password("ValidPassword123!"),
        role="ADMIN",
        is_active=True,
    )
    db_session.add(admin)
    db_session.commit()
    token = create_access_token(subject=admin.id)
    client.headers["Authorization"] = f"Bearer {token}"


def test_list_employees_empty(client):
    response = client.get("/api/v1/employees")
    assert response.status_code == 200
    assert response.json() == []


def test_create_employee_success(client):
    response = client.post("/api/v1/employees", json=SAMPLE_EMPLOYEE)
    assert response.status_code == 201
    data = response.json()
    assert data["id"] is not None
    assert data["employee_code"] == "EMP001"
    assert data["email"] == "john.doe@example.com"
    assert data["first_name"] == "John"
    assert data["last_name"] == "Doe"
    assert data["is_active"] is True


def test_create_employee_duplicate_code(client):
    res1 = client.post("/api/v1/employees", json=SAMPLE_EMPLOYEE)
    assert res1.status_code == 201

    duplicate_code_payload = {
        **SAMPLE_EMPLOYEE,
        "employee_code": "EMP001",
        "email": "different@example.com",
    }
    res2 = client.post("/api/v1/employees", json=duplicate_code_payload)
    assert res2.status_code == 409
    assert res2.json()["detail"] == "Employee code already exists"


def test_create_employee_case_insensitive_code(client):
    res1 = client.post("/api/v1/employees", json=SAMPLE_EMPLOYEE)
    assert res1.status_code == 201

    duplicate_code_payload = {
        **SAMPLE_EMPLOYEE,
        "employee_code": "emp001",  # case variation
        "email": "different2@example.com",
    }
    res2 = client.post("/api/v1/employees", json=duplicate_code_payload)
    assert res2.status_code == 409
    assert res2.json()["detail"] == "Employee code already exists"


def test_create_employee_duplicate_email(client):
    res1 = client.post("/api/v1/employees", json=SAMPLE_EMPLOYEE)
    assert res1.status_code == 201

    duplicate_email_payload = {
        **SAMPLE_EMPLOYEE,
        "employee_code": "EMP002",
        "email": "john.doe@example.com",
    }
    res2 = client.post("/api/v1/employees", json=duplicate_email_payload)
    assert res2.status_code == 409
    assert res2.json()["detail"] == "Email already exists"


def test_create_employee_case_insensitive_email(client):
    res1 = client.post("/api/v1/employees", json=SAMPLE_EMPLOYEE)
    assert res1.status_code == 201

    duplicate_email_payload = {
        **SAMPLE_EMPLOYEE,
        "employee_code": "EMP002",
        "email": "JOHN.DOE@EXAMPLE.COM",  # case variation
    }
    res2 = client.post("/api/v1/employees", json=duplicate_email_payload)
    assert res2.status_code == 409
    assert res2.json()["detail"] == "Email already exists"


def test_create_employee_invalid_payload(client):
    invalid_payload = {
        "employee_code": "",  # invalid: min_length=1
        "first_name": "John",
        "last_name": "Doe",
        "email": "john@example.com",
        "department": "Engineering",
        "designation": "Developer",
        "joining_date": "not-a-date",
    }
    response = client.post("/api/v1/employees", json=invalid_payload)
    assert response.status_code == 422


def test_get_employee_by_id(client):
    res_create = client.post("/api/v1/employees", json=SAMPLE_EMPLOYEE)
    emp_id = res_create.json()["id"]

    res_get = client.get(f"/api/v1/employees/{emp_id}")
    assert res_get.status_code == 200
    assert res_get.json()["id"] == emp_id
    assert res_get.json()["employee_code"] == "EMP001"


def test_get_employee_not_found(client):
    response = client.get("/api/v1/employees/99999")
    assert response.status_code == 404
    assert response.json()["detail"] == "Employee not found"


def test_update_employee_success(client):
    res_create = client.post("/api/v1/employees", json=SAMPLE_EMPLOYEE)
    emp_id = res_create.json()["id"]

    update_payload = {
        "designation": "Senior Software Engineer",
        "department": "Platform Engineering",
    }
    res_patch = client.patch(f"/api/v1/employees/{emp_id}", json=update_payload)
    assert res_patch.status_code == 200
    updated_data = res_patch.json()
    assert updated_data["designation"] == "Senior Software Engineer"
    assert updated_data["department"] == "Platform Engineering"
    assert updated_data["first_name"] == "John"  # preserved


def test_update_employee_partial_preserves_fields(client):
    res_create = client.post("/api/v1/employees", json=SAMPLE_EMPLOYEE)
    emp_id = res_create.json()["id"]

    res_patch = client.patch(f"/api/v1/employees/{emp_id}", json={"is_active": False})
    assert res_patch.status_code == 200
    data = res_patch.json()
    assert data["is_active"] is False
    assert data["employee_code"] == "EMP001"
    assert data["first_name"] == "John"
    assert data["last_name"] == "Doe"
    assert data["department"] == "Engineering"
    assert data["designation"] == "Software Engineer"


def test_update_employee_empty_patch(client):
    res_create = client.post("/api/v1/employees", json=SAMPLE_EMPLOYEE)
    emp_id = res_create.json()["id"]

    res_patch = client.patch(f"/api/v1/employees/{emp_id}", json={})
    assert res_patch.status_code == 200
    data = res_patch.json()
    assert data["id"] == emp_id
    assert data["employee_code"] == "EMP001"
    assert data["email"] == "john.doe@example.com"


def test_update_employee_duplicate_email(client):
    client.post("/api/v1/employees", json=SAMPLE_EMPLOYEE)
    second_emp = {
        **SAMPLE_EMPLOYEE,
        "employee_code": "EMP002",
        "email": "jane.doe@example.com",
    }
    res_second = client.post("/api/v1/employees", json=second_emp)
    emp2_id = res_second.json()["id"]

    # Attempt to update emp2 to emp1's email (case-insensitive)
    patch_res = client.patch(
        f"/api/v1/employees/{emp2_id}",
        json={"email": "JOHN.DOE@EXAMPLE.COM"},
    )
    assert patch_res.status_code == 409
    assert patch_res.json()["detail"] == "Email already exists"


def test_update_employee_not_found(client):
    response = client.patch("/api/v1/employees/99999", json={"first_name": "Ghost"})
    assert response.status_code == 404
    assert response.json()["detail"] == "Employee not found"


def test_delete_employee_success(client):
    res_create = client.post("/api/v1/employees", json=SAMPLE_EMPLOYEE)
    emp_id = res_create.json()["id"]

    del_res = client.delete(f"/api/v1/employees/{emp_id}")
    assert del_res.status_code == 204

    # Verify subsequent GET returns 404
    get_res = client.get(f"/api/v1/employees/{emp_id}")
    assert get_res.status_code == 404


def test_delete_employee_not_found(client):
    response = client.delete("/api/v1/employees/99999")
    assert response.status_code == 404
    assert response.json()["detail"] == "Employee not found"


def test_transaction_rollback_on_integrity_error(client, db_session):
    res1 = client.post("/api/v1/employees", json=SAMPLE_EMPLOYEE)
    assert res1.status_code == 201

    res2 = client.post("/api/v1/employees", json=SAMPLE_EMPLOYEE)
    assert res2.status_code == 409

    # Verify session is still valid and can execute queries after rollback
    employees = db_session.scalars(select(Employee)).all()
    assert len(employees) == 1
    assert employees[0].employee_code == "EMP001"


def test_timestamp_update_behavior(client, db_session):
    res_create = client.post("/api/v1/employees", json=SAMPLE_EMPLOYEE)
    assert res_create.status_code == 201
    emp_id = res_create.json()["id"]

    emp = db_session.get(Employee, emp_id)
    assert emp is not None

    # Deterministic test: set past timestamps in savepoint
    past_time = datetime(2020, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    emp.created_at = past_time
    emp.updated_at = past_time
    db_session.commit()

    # Trigger update via API
    patch_res = client.patch(
        f"/api/v1/employees/{emp_id}",
        json={"designation": "Principal Engineer"},
    )
    assert patch_res.status_code == 200

    db_session.refresh(emp)
    # created_at remains unchanged
    assert emp.created_at == past_time
    # updated_at has been updated to current time
    assert emp.updated_at > past_time
    assert (datetime.now(timezone.utc) - emp.updated_at).total_seconds() < 60
