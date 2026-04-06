-- Dernier recours : même schéma sans clé étrangère (hébergeur qui refuse les FK,
-- ou impossible d'aligner le collationnement sans ALTER sur `events`).
-- L'intégrité event_id → events reste assurée par l'application ; les suppressions
-- d'événements ne supprimeront pas automatiquement les lignes user_bans.

CREATE TABLE IF NOT EXISTS user_bans (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  event_id     VARCHAR(36) NOT NULL,
  client_id    VARCHAR(255) NOT NULL,
  user_name    VARCHAR(255) NULL,
  banned_until BIGINT       NULL COMMENT 'timestamp ms, NULL = permanent pour toute la soirée',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_client (event_id, client_id),
  KEY idx_user_bans_event (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
