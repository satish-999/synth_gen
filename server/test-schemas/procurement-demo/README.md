# Procurement demo — Excel schemas

Upload **one file** when creating a new model:

**`procurement_demo_schemas.xlsx`**

Each worksheet is one table (6 sheets total).

## Sheets

| Sheet | What it is |
|-------|------------|
| `cost_center` | Budget / org units |
| `vendor` | Suppliers |
| `material` | Items purchased |
| `buyer` | Procurement buyers → cost_center |
| `po_header` | Purchase order header → vendor, buyer |
| `po_line` | PO lines → po_header, material |

## Relationships

```
cost_center  ←  buyer  ←  po_header  →  vendor
                              ↑
                           po_line  →  material
```

## Create model

1. **+ Create new model**
2. **Family ID:** `procurement`
3. **Display name:** `Procurement Demo`
4. **Schema file:** upload `procurement_demo_schemas.xlsx` only
5. Review → confirm FKs → **Register model (v1)**

## Regenerate this file (optional)

```powershell
cd server
npx tsx src/build-procurement-xlsx.ts
```

> **Note:** CSV, SQL, and JSON upload are supported by the engine for a future release. This demo uses Excel only for simplicity.
