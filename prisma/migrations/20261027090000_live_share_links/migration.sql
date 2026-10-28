-- Links efímeros de seguimiento en vivo de una unidad (2026-10-27).
-- El token es el único secreto: quien tiene el link ve el recorrido
-- de esa unidad hasta expiresAt (o hasta que se revoque), sin login.

CREATE TABLE LiveShareLink (
  id                INT NOT NULL AUTO_INCREMENT,
  token             VARCHAR(64) NOT NULL,
  unitId            INT NOT NULL,
  ticketId          INT NULL,
  createdByUserId   INT NULL,
  createdByUsername VARCHAR(191) NULL,
  expiresAt         DATETIME(3) NOT NULL,
  revokedAt         DATETIME(3) NULL,
  createdAt         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE INDEX LiveShareLink_token_key (token),
  INDEX LiveShareLink_unitId_idx (unitId),
  INDEX LiveShareLink_expiresAt_idx (expiresAt)
);
