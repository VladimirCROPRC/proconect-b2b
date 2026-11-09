CREATE TABLE orange_oroc_tickets (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_number TEXT NOT NULL UNIQUE,
  work_date TEXT NOT NULL,
  service_package_code TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX orange_oroc_work_date_idx ON orange_oroc_tickets(work_date);
