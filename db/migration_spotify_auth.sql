-- Migration: authentification via Spotify (remplacement email/password)
-- Exécuter ce script UNE seule fois sur la base de données existante.

ALTER TABLE `djs`
  ADD COLUMN `spotify_id`     VARCHAR(255) NULL UNIQUE AFTER `id`,
  ADD COLUMN `spotify_avatar` TEXT         NULL AFTER `name`,
  MODIFY COLUMN `email`    VARCHAR(255) NULL DEFAULT NULL,
  MODIFY COLUMN `password` VARCHAR(255) NULL DEFAULT NULL;

-- Supprimer l'index unique sur email (email peut maintenant être NULL pour les nouveaux comptes)
-- Note: MySQL ne permet pas plusieurs NULL dans un UNIQUE index selon la version
ALTER TABLE `djs` DROP INDEX `email`;

-- Recréer un index non-unique sur email pour les performances
ALTER TABLE `djs` ADD INDEX `idx_email` (`email`);
