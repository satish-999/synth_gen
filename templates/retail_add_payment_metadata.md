# Retail model — add payment tracking

Business metadata for a new table to be added to the existing retail model.
This is an **additive update**: no existing table, column or rule should change.

---

## New table: `payment`

Records money received against a sales order. An order is paid in one or more
instalments, so a single order can have several payment rows.

### Purpose

Finance needs to see what has been collected against each order, by which
method, and whether anything is still outstanding.

### Columns

| Column | Type | Key | Description |
|---|---|---|---|
| `payment_id` | string | Primary key | Unique payment reference, formatted `PAY-` followed by six digits, e.g. `PAY-004182`. Always populated, never repeated. |
| `order_id` | string | Foreign key → `sales_order.order_id` | The order this payment settles. This is the owning relationship: each order has between 1 and 3 payments, most commonly 1. Every payment belongs to exactly one existing order. |
| `payment_date` | date | | When the payment was received. Falls between 1 and 30 days after the order was placed. |
| `payment_method` | string | | How the customer paid. One of: `CARD`, `UPI`, `NET_BANKING`, `CASH_ON_DELIVERY`, `WALLET`. Card is most common (about 45%), then UPI (30%), net banking (12%), cash on delivery (8%), wallet (5%). |
| `amount` | decimal(12,2) | | Amount received in this instalment. Between 50.00 and 8000.00. |
| `payment_status` | string | | One of `CAPTURED`, `PENDING`, `FAILED`, `REFUNDED`. Roughly 80% captured, 8% pending, 7% failed, 5% refunded. |
| `settled_date` | date | | When the money reached the merchant account. Between 1 and 5 days after `payment_date`. Only populated when the payment was captured or refunded — empty for pending and failed payments. |
| `reference_no` | string | | Gateway reference, formatted as four uppercase letters followed by eight digits, e.g. `AXBQ40391182`. |

### Relationship

- `payment.order_id` references `sales_order.order_id`.
- This is the **sizing** relationship for the payment table: the number of
  payment rows is driven by the number of orders, at 1 to 3 payments per order
  with an average of about 1.3. No order should have zero payments.

### Business rules

1. `payment_date` must not be earlier than the order's date.
2. `settled_date` must not be earlier than `payment_date`.
3. When `payment_status` is `PENDING` or `FAILED`, `settled_date` must be empty.
4. When `payment_status` is `CAPTURED` or `REFUNDED`, `settled_date` must be
   populated.

---

## What must not change

The existing tables — `category`, `customer`, `product`, `sales_order` and
`order_item` — and all of their columns, generators and rules must be preserved
exactly as they are in the current version. Only the `payment` table and its
four new rules are being added.
