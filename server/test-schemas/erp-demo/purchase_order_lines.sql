-- Purchase order lines (links to PO header and product)
CREATE TABLE purchase_order_line (
  line_id VARCHAR(20) PRIMARY KEY,
  purchase_order_id VARCHAR(20) NOT NULL,
  product_id VARCHAR(20) NOT NULL,
  quantity INT,
  unit_price DECIMAL(10,2),
  line_total DECIMAL(12,2)
);
