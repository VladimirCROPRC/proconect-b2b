ALTER TABLE projects ADD COLUMN completed_at INTEGER;
CREATE INDEX projects_technician_completed_idx ON projects(technician_username, status, completed_at);
-- Only intervention validation provides a historical completion timestamp.
-- Other finalized works remain undated until management enters the actual date.
UPDATE projects SET completed_at = (
  SELECT CAST(json_extract(d.content_json, '$.intervention.documentation.validatedAt') AS INTEGER)
  FROM project_field_documentation d WHERE d.project_id = projects.id AND json_valid(d.content_json)
    AND json_type(d.content_json, '$.intervention.documentation.validatedAt') = 'integer'
    AND json_extract(d.content_json, '$.intervention.documentation.validatedAt') > 0
) WHERE status = 'Finalizat' AND activity_type = 'Intervenție';
