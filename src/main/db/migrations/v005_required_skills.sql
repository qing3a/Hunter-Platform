-- v005: required_skills for jobs
-- Stored as JSON-encoded TEXT array for simplicity; parsed back to string[] on read.

ALTER TABLE jobs ADD COLUMN required_skills_json TEXT;