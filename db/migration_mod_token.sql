-- Migration : système de modération par événement
-- Le DJ peut générer un token pour inviter des modérateurs
ALTER TABLE events
  ADD COLUMN mod_token VARCHAR(64) NULL DEFAULT NULL AFTER donation_message;
