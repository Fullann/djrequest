-- Migration: stocker les tokens Spotify du DJ directement sur le compte (pas seulement par événement)
-- Exécuter ce script UNE seule fois.

ALTER TABLE `djs`
  ADD COLUMN `sp_access_token`   TEXT   NULL AFTER `spotify_avatar`,
  ADD COLUMN `sp_refresh_token`  TEXT   NULL AFTER `sp_access_token`,
  ADD COLUMN `sp_token_expires_at` BIGINT NULL AFTER `sp_refresh_token`;
