-- CreateTable
CREATE TABLE `Sim` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `iccid` VARCHAR(191) NOT NULL,
    `phoneNumber` VARCHAR(191) NULL,
    `pin` VARCHAR(191) NULL,
    `puk` VARCHAR(191) NULL,
    `trackerUid` VARCHAR(191) NULL,
    `externalId` VARCHAR(191) NULL,
    `syncStatus` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `syncError` VARCHAR(191) NULL,
    `syncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Sim_iccid_key`(`iccid`),
    UNIQUE INDEX `Sim_externalId_key`(`externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
