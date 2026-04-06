-- Migration : stocker le clientId persistant sur chaque demande (pour le système de ban)
ALTER TABLE requests
  ADD COLUMN client_id VARCHAR(255) NULL AFTER socket_id;

CREATE INDEX idx_requests_client_id ON requests(client_id);
