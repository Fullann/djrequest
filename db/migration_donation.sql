-- Migration : système de dons par événement
ALTER TABLE events
  ADD COLUMN donation_enabled    TINYINT(1)     NOT NULL DEFAULT 0    AFTER fallback_playlist_uri,
  ADD COLUMN donation_required   TINYINT(1)     NOT NULL DEFAULT 0    AFTER donation_enabled,
  ADD COLUMN donation_amount     DECIMAL(10,2)  NOT NULL DEFAULT 2.00 AFTER donation_required,
  ADD COLUMN donation_link       VARCHAR(500)   NULL                  AFTER donation_amount,
  ADD COLUMN donation_message    VARCHAR(500)   NULL                  AFTER donation_link;
