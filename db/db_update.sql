-- Ajouter la table des DJs
CREATE TABLE IF NOT EXISTS djs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email)
);

-- Ajouter la colonne dj_id à events
ALTER TABLE events ADD COLUMN dj_id INT NULL;
ALTER TABLE events ADD FOREIGN KEY (dj_id) REFERENCES djs(id) ON DELETE SET NULL;

-- Vue stats avancées par DJ
CREATE OR REPLACE VIEW dj_stats AS
SELECT 
  e.dj_id,
  e.id as event_id,
  e.name as event_name,
  e.created_at,
  COUNT(DISTINCT r.id) as total_songs,
  COUNT(DISTINCT CASE WHEN r.status = 'played' THEN r.id END) as played_songs,
  COUNT(DISTINCT CASE WHEN r.status = 'rejected' THEN r.id END) as rejected_songs,
  AVG(CASE WHEN r.status = 'played' THEN 
    (SELECT COUNT(*) FROM votes v WHERE v.request_id = r.id AND v.vote_type = 'up') 
  END) as avg_upvotes
FROM events e
LEFT JOIN requests r ON e.id = r.event_id
WHERE e.dj_id IS NOT NULL
GROUP BY e.id, e.dj_id, e.name, e.created_at;

-- Vue top chansons par DJ
CREATE OR REPLACE VIEW top_songs_by_dj AS
SELECT 
  e.dj_id,
  r.song_name,
  r.artist,
  COUNT(*) as play_count,
  AVG((SELECT COUNT(*) FROM votes v WHERE v.request_id = r.id AND v.vote_type = 'up')) as avg_upvotes
FROM events e
INNER JOIN requests r ON e.id = r.event_id
WHERE r.status = 'played' AND e.dj_id IS NOT NULL
GROUP BY e.dj_id, r.song_name, r.artist
ORDER BY play_count DESC, avg_upvotes DESC;