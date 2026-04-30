-- Différencier les morceaux joués via playlist de secours
ALTER TABLE requests
  ADD COLUMN is_fallback_source TINYINT(1) NOT NULL DEFAULT 0 AFTER skipped_at;

