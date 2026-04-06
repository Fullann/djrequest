-- Migration : système de blocage d'invités par événement
--
-- Si vous obtenez l'erreur #150 (Foreign key incorrectly formed) en production :
-- 1) Vérifiez que la table `events` est bien InnoDB :
--      SHOW TABLE STATUS WHERE Name = 'events';
-- 2) Affichez le collationnement exact de `events.id` :
--      SHOW FULL COLUMNS FROM events WHERE Field = 'id';
-- 3) La colonne `event_id` ci-dessous DOIT avoir le même charset + collation que `events.id`.
--    Sur beaucoup d'hébergeurs (MariaDB, cPanel), c'est utf8mb4_unicode_ci :
--    utilisez alors migration_user_bans_o2switch_unicode.sql à la place de ce fichier.
--
CREATE TABLE IF NOT EXISTS user_bans (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  event_id     VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  client_id    VARCHAR(255) NOT NULL,
  user_name    VARCHAR(255) NULL,
  banned_until BIGINT       NULL COMMENT 'timestamp ms, NULL = permanent pour toute la soirée',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_client (event_id, client_id),
  CONSTRAINT fk_bans_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
