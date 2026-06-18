-- STD-13 Expand: nullable address columns, zero risk to existing rows.
ALTER TABLE crm_companies
  ADD COLUMN address_line1  VARCHAR(200),
  ADD COLUMN address_line2  VARCHAR(200),
  ADD COLUMN city           VARCHAR(100),
  ADD COLUMN state_province VARCHAR(100),
  ADD COLUMN postal_code    VARCHAR(20);
