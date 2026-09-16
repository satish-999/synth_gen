-- Adds payment tracking to the retail model.
-- Structured DDL: parsed by the rule-based agent, no API key required.

CREATE TABLE payment (
    payment_id      VARCHAR(20)     NOT NULL,
    order_id        VARCHAR(20)     NOT NULL,
    payment_date    DATE            NOT NULL,
    payment_method  VARCHAR(20)     NOT NULL,
    amount          DECIMAL(12,2)   NOT NULL,
    payment_status  VARCHAR(20)     NOT NULL,
    settled_date    DATE            NULL,
    reference_no    VARCHAR(32)     NOT NULL,

    CONSTRAINT pk_payment PRIMARY KEY (payment_id),
    CONSTRAINT fk_payment_order FOREIGN KEY (order_id)
        REFERENCES sales_order (order_id)
);
