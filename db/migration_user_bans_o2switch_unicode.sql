-- Variante user_bans pour MySQL/MariaDB où `events.id` est en utf8mb4_unicode_ci
-- (souvent le cas sur o2switch, hébergements mutualisés, imports anciens).
-- Vérifiez avec : SHOW FULL COLUMNS FROM events WHERE Field = 'id';
--
-- Si la table user_bans a déjà été créée sans FK (échec partiel), supprimez-la d'abord :
--   DROP TABLE IF EXISTS user_bans;

CREATE TABLE IF NOT EXISTS user_bans (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  event_id     VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  client_id    VARCHAR(255) NOT NULL,
  user_name    VARCHAR(255) NULL,
  banned_until BIGINT       NULL COMMENT 'timestamp ms, NULL = permanent pour toute la soirée',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_client (event_id, client_id),
  CONSTRAINT fk_bans_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
