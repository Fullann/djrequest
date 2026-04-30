-- Réglages visuels pour l'écran de projection (QR display)
ALTER TABLE events
  ADD COLUMN projection_visuals_enabled TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Active les effets colorés sur /event/:eventId/qr',
  ADD COLUMN projection_visuals_mode VARCHAR(24) NOT NULL DEFAULT 'aurora'
    COMMENT 'Mode visuel: aurora | pulse | strobe';

<