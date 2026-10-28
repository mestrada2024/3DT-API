-- Adjuntos de mensajes del chat (ej. reporte PDF de un vehículo que
-- genera el bot) — 2026-10-26. El archivo se guarda en la base
-- (MEDIUMBLOB, hasta 16 MB) para que viaje con los respaldos de la BD
-- y no dependa de un volumen del contenedor.

CREATE TABLE ChatAttachment (
  id        INT NOT NULL AUTO_INCREMENT,
  ticketId  INT NOT NULL,
  messageId INT NOT NULL,
  fileName  VARCHAR(191) NOT NULL,
  mimeType  VARCHAR(191) NOT NULL,
  sizeBytes INT NOT NULL,
  data      MEDIUMBLOB NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX ChatAttachment_ticketId_idx (ticketId),
  INDEX ChatAttachment_messageId_idx (messageId)
);
