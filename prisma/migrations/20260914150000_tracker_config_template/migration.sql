-- CreateTable
CREATE TABLE `TrackerConfigTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `unitModelUid` VARCHAR(191) NOT NULL,
    `unitModelName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TrackerConfigTemplate_unitModelUid_key`(`unitModelUid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TrackerConfigAttribute` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NULL,

    UNIQUE INDEX `TrackerConfigAttribute_templateId_name_key`(`templateId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TrackerConfigAttribute` ADD CONSTRAINT `TrackerConfigAttribute_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `TrackerConfigTemplate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
