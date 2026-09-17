-- CreateTable
CREATE TABLE `CriticalAlertScanCursor` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `startId` BIGINT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
