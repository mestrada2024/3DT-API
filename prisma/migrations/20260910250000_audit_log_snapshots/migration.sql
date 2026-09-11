-- AlterTable (registrar parámetros enviados y snapshots antes/después de
-- cada operación de escritura)
ALTER TABLE `AuditLog` ADD COLUMN `requestBody` LONGTEXT NULL;
ALTER TABLE `AuditLog` ADD COLUMN `beforeState` LONGTEXT NULL;
ALTER TABLE `AuditLog` ADD COLUMN `afterState` LONGTEXT NULL;
