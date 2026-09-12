-- Purchase order header (links to supplier)
CREATE TABLE purchase_order (
  purchase_order_id VARCHAR(20) PRIMARY KEY,
  supplier_id VARCHAR(20) NOT NULL,
  order_date DATE,
  status VARCHAR(20),
  total_amount DECIMAL(12,2),
  created_by_employee_id VARCHAR(20)
);
