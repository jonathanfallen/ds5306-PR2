-- ============================================================
-- TABLE: users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_name VARCHAR(100) NOT NULL,
  password_plain VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_user_name (user_name)
);

-- ============================================================
-- TABLE: sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  credential VARCHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_credential (credential),
  KEY idx_sessions_user_id (user_id),
  KEY idx_sessions_expires_at (expires_at),
  CONSTRAINT fk_sessions_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
);

-- ============================================================
-- DEMO USER
-- ============================================================
INSERT INTO users (user_name, password_plain)
VALUES ('demo', 'demo')
ON DUPLICATE KEY UPDATE password_plain = VALUES(password_plain);

-- ============================================================
-- PERF SEED: perf_demo0..perf_demo4999  (password='demo')
-- Robust: no recursive CTE, safe for Docker init.
-- Idempotent via INSERT IGNORE.
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS seed_perf_users $$
CREATE PROCEDURE seed_perf_users()
BEGIN
  DECLARE i INT DEFAULT 0;

  WHILE i < 5000 DO
    INSERT IGNORE INTO users (user_name, password_plain, is_active)
    VALUES (CONCAT('perf_demo', i), 'demo', 1);

    SET i = i + 1;
  END WHILE;
END $$

CALL seed_perf_users() $$
DROP PROCEDURE seed_perf_users $$

DELIMITER ;
