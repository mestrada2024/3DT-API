-- CreateTable
CREATE TABLE `TrackerType` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uid` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TrackerType_uid_key`(`uid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TrackerTypeModel` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `trackerTypeId` INTEGER NOT NULL,
    `unitModelUid` VARCHAR(191) NOT NULL,
    `unitModelName` VARCHAR(191) NULL,

    UNIQUE INDEX `TrackerTypeModel_trackerTypeId_unitModelUid_key`(`trackerTypeId`, `unitModelUid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TrackerTypeModel` ADD CONSTRAINT `TrackerTypeModel_trackerTypeId_fkey` FOREIGN KEY (`trackerTypeId`) REFERENCES `TrackerType`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
