CREATE TABLE shipment (
  shipment_id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL,
  carrier VARCHAR(50),
  shipped_date DATE,
  tracking_number VARCHAR(100)
);
