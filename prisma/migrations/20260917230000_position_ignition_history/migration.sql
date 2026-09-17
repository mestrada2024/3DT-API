-- AlterTable
ALTER TABLE `Position` ADD COLUMN `ignition` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Position_unitId_recordedAt_key` ON `Position`(`unitId`, `recordedAt`);
