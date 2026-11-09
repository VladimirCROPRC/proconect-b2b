ALTER TABLE orange_oroc_tickets ADD COLUMN technician_username TEXT;
ALTER TABLE orange_oroc_tickets ADD COLUMN technician_name TEXT NOT NULL DEFAULT '';
CREATE INDEX orange_oroc_technician_idx ON orange_oroc_tickets(technician_username, work_date);
