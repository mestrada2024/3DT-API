-- Convierte WhatsappAlertConfig de fila única (id fijo = 1) a
-- múltiples plantillas con autoincrement + createdAt. La fila id=1
-- existente se conserva tal cual.

ALTER TABLE WhatsappAlertConfig
  MODIFY id INT NOT NULL AUTO_INCREMENT,
  ADD COLUMN createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER templateText;

ALTER TABLE WhatsappAlertConfig AUTO_INCREMENT = 2;
