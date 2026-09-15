# Add two tables to the workforce model

Upload this file using Add tables to the selected workforce model, after
registering the first sample. The employee table is provided by that base model.

## Table: skills

| column_name | data_type | is_pk | fk_ref |
| --- | --- | --- | --- |
| skill_id | string | Y | - |
| name | string | N | - |
| family | string | N | - |

## Table: employee_skills

| column_name | data_type | is_pk | fk_ref |
| --- | --- | --- | --- |
| employee_skill_id | string | Y | - |
| employee_id | string | N | employees.employee_id |
| skill_id | string | N | skills.skill_id |
| proficiency | int | N | - |