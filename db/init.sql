-- Database: dj_queue

-- Table des événements
CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  allow_duplicates BOOLEAN DEFAULT FALSE,
  ended_at TIMESTAMP NULL
);

-- Table des demandes de chansons
CREATE TABLE IF NOT EXISTS requests (
  id VARCHAR(36) PRIMARY KEY,
  event_id VARCHAR(36) NOT NULL,
  song_name VARCHAR(255) NOT NULL,
  artist VARCHAR(255),
  album VARCHAR(255),
  image_url TEXT,
  spotify_uri VARCHAR(255),
  duration_ms INT,
  user_name VARCHAR(100) DEFAULT 'Anonyme',
  socket_id VARCHAR(100),
  status ENUM('pending', 'accepted', 'rejected', 'played') DEFAULT 'pending',
  queue_position INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  played_at TIMESTAMP NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  INDEX idx_event_status (event_id, status),
  INDEX idx_queue_position (event_id, queue_position)
);

-- Table des votes
CREATE TABLE IF NOT EXISTS votes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(36) NOT NULL,
  socket_id VARCHAR(100) NOT NULL,
  vote_type ENUM('up', 'down') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
  UNIQUE KEY unique_vote (request_id, socket_id),
  INDEX idx_request_votes (request_id)
);

-- Table des tokens Spotify
CREATE TABLE IF NOT EXISTS spotify_tokens (
  event_id VARCHAR(36) PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Table rate limiting
CREATE TABLE IF NOT EXISTS rate_limits (
  socket_id VARCHAR(100) PRIMARY KEY,
  request_count INT DEFAULT 0,
  reset_at BIGINT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Vue pour les statistiques
CREATE OR REPLACE VIEW request_stats AS
SELECT 
  r.id,
  r.event_id,
  r.song_name,
  r.artist,
  r.status,
  COUNT(DISTINCT CASE WHEN v.vote_type = 'up' THEN v.id END) as upvotes,
  COUNT(DISTINCT CASE WHEN v.vote_type = 'down' THEN v.id END) as downvotes,
  (COUNT(DISTINCT CASE WHEN v.vote_type = 'up' THEN v.id END) - 
   COUNT(DISTINCT CASE WHEN v.vote_type = 'down' THEN v.id END)) as net_votes
FROM requests r
LEFT JOIN votes v ON r.id = v.request_id
GROUP BY r.id, r.event_id, r.song_name, r.artist, r.status;

-- Vue pour l'historique des événements
CREATE OR REPLACE VIEW event_history AS
SELECT 
  e.id,
  e.name,
  e.created_at,
  e.ended_at,
  COUNT(DISTINCT r.id) as total_requests,
  COUNT(DISTINCT CASE WHEN r.status = 'played' THEN r.id END) as played_count,
  COUNT(DISTINCT CASE WHEN r.status = 'rejected' THEN r.id END) as rejected_count
FROM events e
LEFT JOIN requests r ON e.id = r.event_id
GROUP BY e.id, e.name, e.created_at, e.ended_at;

-- Insérer des données de test (optionnel)
-- INSERT INTO events (id, name) VALUES ('test-event-123', 'Soirée Test');
