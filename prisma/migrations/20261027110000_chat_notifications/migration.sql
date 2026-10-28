-- Notificaciones internas por usuario (2026-10-27). Primer uso: cuando
-- el cliente escribe "agente", se avisa a los agentes y supervisores
-- de la cola elegida (ver chat-bot.service.ts → handOffToAgent).

CREATE TABLE ChatNotification (
  id        INT NOT NULL AUTO_INCREMENT,
  userId    INT NOT NULL,
  ticketId  INT NULL,
  type      VARCHAR(191) NOT NULL,
  title     VARCHAR(191) NOT NULL,
  body      TEXT NOT NULL,
  readAt    DATETIME(3) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX ChatNotification_userId_readAt_idx (userId, readAt),
  INDEX ChatNotification_ticketId_idx (ticketId)
);
