# Workforce planner: sample metadata

This structured data dictionary defines four tables. Upload this file in the
Model authoring agent. It works in local mode without a Claude API key.
Generators and distributions are proposed defaults to review before registration.

## Table: roles

| column_name | data_type | is_pk | fk_ref |
| --- | --- | --- | --- |
| role_id | string | Y | - |
| title | string | N | - |
| standard_rate | decimal | N | - |

## Table: employees

| column_name | data_type | is_pk | fk_ref |
| --- | --- | --- | --- |
| employee_id | string | Y | - |
| name | string | N | - |
| role_id | string | N | roles.role_id |
| department | string | N | - |
| hire_date | date | N | - |

## Table: projects

| column_name | data_type | is_pk | fk_ref |
| --- | --- | --- | --- |
| project_id | string | Y | - |
| name | string | N | - |
| start_date | date | N | - |
| end_date | date | N | - |

## Table: assignments

| column_name | data_type | is_pk | fk_ref |
| --- | --- | --- | --- |
| assignment_id | string | Y | - |
| employee_id | string | N | employees.employee_id |
| project_id | string | N | projects.project_id |
| allocation_pct | int | N | - |
| start_date | date | N | - |
| end_date | date | N | - |