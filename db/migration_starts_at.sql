-- Migration : planification des soirées (date/heure d'ouverture des demandes)
ALTER TABLE events
  ADD COLUMN starts_at DATETIME NULL DEFAULT NULL AFTER created_at;
