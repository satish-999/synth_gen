# Workforce planning metadata for AI model authoring

This is free-form metadata for Claude mode; it requires the server's Claude API
connection. It does not use the offline structured Markdown format.

The application tracks roles, employees, projects and assignments. Use these
exact table and column names, with string primary keys and explicit relationships.

roles: role_id (primary key), title (string), standard_rate (decimal).
Allowed titles are Engineer, Analyst and Project Manager. Standard rates range
from 30 to 150. No particular currency or billing period has been specified.

employees: employee_id (primary key), name (person name), role_id (foreign key to
roles.role_id), department (string), hire_date (date). Departments are Engineering,
Operations and Finance. Hire dates range from 2020-01-01 to 2026-01-01.

projects: project_id (primary key), name (string), start_date (date), end_date
(date). Projects start during 2026 and end 30 to 180 days after their start.

assignments: assignment_id (primary key), employee_id (foreign key to
employees.employee_id), project_id (foreign key to projects.project_id),
allocation_pct (integer), start_date (date), end_date (date). Allocation choices
are 10, 20, 25 and 50. Each assignment must end on or after its own start.

All columns are required. Treat all relationships as REFERENCE so users can
choose row counts independently. Explain any engine limitations in draft warnings.
Aggregate overlapping allocations and assignment dates relative to project dates
are outside this sample's requirements. Do not claim to enforce those checks.