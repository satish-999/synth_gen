CREATE TABLE loan (
  loan_id VARCHAR(20) PRIMARY KEY,
  member_id VARCHAR(20) NOT NULL,
  book_id VARCHAR(20) NOT NULL,
  loan_date DATE,
  status VARCHAR(20)
);
