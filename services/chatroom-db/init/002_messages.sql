CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_name VARCHAR(100) NOT NULL,
  person_name VARCHAR(100) NOT NULL,
  text TEXT NOT NULL,
  msg_id VARCHAR(128) NULL,
  client_ts_ms BIGINT NULL,
  server_ts_ms BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_messages_room (room_name, id)
);
