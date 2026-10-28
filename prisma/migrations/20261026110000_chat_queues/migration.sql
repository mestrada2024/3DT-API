-- Colas de soporte ("grupos de usuarios") para el modelo de permisos
-- de tickets — proyecto chatbot Dada Fleet, 2026-10-26.

CREATE TABLE ChatQueue (
  id        INT NOT NULL AUTO_INCREMENT,
  name      VARCHAR(191) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE INDEX ChatQueue_name_key (name)
);

CREATE TABLE UserQueue (
  id        INT NOT NULL AUTO_INCREMENT,
  userId    INT NOT NULL,
  queueId   INT NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE INDEX UserQueue_userId_queueId_key (userId, queueId),
  INDEX UserQueue_queueId_idx (queueId)
);

ALTER TABLE ChatTicket
  ADD COLUMN queueId INT NULL,
  ADD INDEX ChatTicket_queueId_idx (queueId),
  ADD INDEX ChatTicket_assignedToUserId_idx (assignedToUserId);
