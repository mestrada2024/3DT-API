ALTER TABLE `CriticalAlertEvent`
  ADD COLUMN `whatsappStatus` VARCHAR(191) NULL,
  ADD COLUMN `whatsappSentAt` DATETIME(3) NULL,
  ADD COLUMN `whatsappError` TEXT NULL;

CREATE INDEX `CriticalAlertEvent_whatsappStatus_idx` ON `CriticalAlertEvent`(`whatsappStatus`);

-- Alertas existentes antes de que este servicio existiera: se marcan
-- como "skipped_backfill" para que el nuevo dispatcher no las procese
-- retroactivamente (evita un envío masivo de WhatsApp por eventos
-- viejos apenas se activa un tipo de alerta).
UPDATE `CriticalAlertEvent` SET `whatsappStatus` = 'skipped_backfill' WHERE `whatsappStatus` IS NULL;
