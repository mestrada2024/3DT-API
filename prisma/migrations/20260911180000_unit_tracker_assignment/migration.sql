-- AlterTable (una unidad recien creada puede no tener tracker/imei
-- todavia asignado)
ALTER TABLE `Unit` MODIFY `trackingId` BIGINT NULL;
ALTER TABLE `Unit` ADD COLUMN `trackerUid` VARCHAR(191) NULL;

-- AlterTable (vinculo bidireccional Tracker <-> Unit)
ALTER TABLE `Tracker` ADD COLUMN `unitUid` VARCHAR(191) NULL;
