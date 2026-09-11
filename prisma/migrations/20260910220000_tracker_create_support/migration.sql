-- AlterTable (uid deja de ser obligatorio: un tracker creado localmente
-- primero no tiene Uid de 3Dtracking hasta que se replica con éxito)
ALTER TABLE `Tracker` MODIFY `uid` VARCHAR(191) NULL;

-- AlterTable (imei único: es el identificador natural del tracker)
ALTER TABLE `Tracker` ADD UNIQUE INDEX `Tracker_imei_key`(`imei`);

-- AlterTable (estado de sincronización con 3Dtracking, igual que Sim;
-- 'synced' por default porque los 360 registros existentes ya vienen
-- confirmados desde devices/tracker/list)
ALTER TABLE `Tracker` ADD COLUMN `syncStatus` VARCHAR(191) NOT NULL DEFAULT 'synced';
ALTER TABLE `Tracker` ADD COLUMN `syncError` VARCHAR(191) NULL;
ALTER TABLE `Tracker` ADD COLUMN `syncedAt` DATETIME(3) NULL;
