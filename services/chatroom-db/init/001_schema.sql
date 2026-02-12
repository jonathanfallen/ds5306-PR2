CREATE TABLE IF NOT EXISTS chat_rooms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chat_rooms_room_name (room_name)
);

CREATE TABLE IF NOT EXISTS room_people (
  room_id BIGINT UNSIGNED NOT NULL,
  person_name VARCHAR(100) NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, person_name),
  KEY idx_room_people_person (person_name),
  CONSTRAINT fk_room_people_room
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id)
    ON DELETE CASCADE
);
