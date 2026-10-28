-- Recorrido histórico (2026-10-27): un LiveShareLink con rangeFrom y
-- rangeTo muestra el recorrido de ese período (mapa estático) en vez
-- del seguimiento en vivo.

ALTER TABLE LiveShareLink
  ADD COLUMN rangeFrom DATETIME(3) NULL,
  ADD COLUMN rangeTo   DATETIME(3) NULL;
