CREATE TABLE IF NOT EXISTS teacher_rates (
  branch_id text NOT NULL,
  teacher_id text NOT NULL,
  teacher_name text NOT NULL,
  hourly_rate integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  updated_at bigint NOT NULL,
  PRIMARY KEY (branch_id, teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_rates_name
  ON teacher_rates (teacher_name);
