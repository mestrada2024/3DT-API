-- Respaldo de los eventos que se van a eliminar (todo lo que no sea
-- PANIC_BUTTON) antes de limpiar la tabla, por si hace falta
-- consultarlos después.
CREATE TABLE `CriticalAlertEvent_backup_20260918` AS
  SELECT * FROM `CriticalAlertEvent` WHERE `alertTypeCode` != 'PANIC_BUTTON';

-- Limpieza: solo Botón de pánico es una alarma permitida/real de
-- negocio, el resto (1495 puerta del motorista, 165 falla de energía,
-- etc.) no debería haber estado acumulándose.
DELETE FROM `CriticalAlertEvent` WHERE `alertTypeCode` != 'PANIC_BUTTON';

-- Los eventos de PANIC_BUTTON que sobreviven quedan disponibles de
-- nuevo para el futuro despacho de WhatsApp (el backfill anterior los
-- había marcado skipped_backfill junto con todo lo demás).
UPDATE `CriticalAlertEvent` SET `whatsappStatus` = NULL WHERE `alertTypeCode` = 'PANIC_BUTTON';

-- Tabla 2: alarmas permitidas (whitelist) — reemplaza el booleano
-- notifyWhatsapp por una tabla separada, y además gatea qué señales
-- vigila el escáner.
CREATE TABLE `AllowedAlertType` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `alertTypeCode` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `AllowedAlertType_alertTypeCode_key` (`alertTypeCode`)
);

INSERT INTO `AllowedAlertType` (`alertTypeCode`) VALUES ('PANIC_BUTTON');

ALTER TABLE `CriticalAlertType` DROP COLUMN `notifyWhatsapp`;
