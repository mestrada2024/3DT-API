-- AlterTable (SystemName real de 3Dtracking a comparar contra
-- InputOutputs de cada posicion, ej. "panic" para el boton de panico)
ALTER TABLE `CriticalAlertType` ADD COLUMN `matchSystemName` VARCHAR(191) NULL;

UPDATE `CriticalAlertType` SET `matchSystemName` = 'panic' WHERE `code` = 'PANIC_BUTTON';

-- CreateTable
CREATE TABLE `CriticalAlertEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alertTypeCode` VARCHAR(191) NOT NULL,
    `alertTypeName` VARCHAR(191) NOT NULL,
    `unitUid` VARCHAR(191) NOT NULL,
    `unitName` VARCHAR(191) NULL,
    `unitImei` VARCHAR(191) NULL,
    `companyUid` VARCHAR(191) NULL,
    `driverName` VARCHAR(191) NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `address` TEXT NULL,
    `speed` DECIMAL(10, 2) NULL,
    `heading` DECIMAL(10, 2) NULL,
    `description` VARCHAR(191) NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CriticalAlertEvent_unitUid_alertTypeCode_occurredAt_key`(`unitUid`, `alertTypeCode`, `occurredAt`),
    INDEX `CriticalAlertEvent_alertTypeCode_idx`(`alertTypeCode`),
    INDEX `CriticalAlertEvent_occurredAt_idx`(`occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
