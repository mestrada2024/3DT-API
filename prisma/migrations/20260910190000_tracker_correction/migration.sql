-- DropTable (tablas creadas contra el endpoint equivocado, devices/trackertype/list, que no aplica a esta cuenta)
DROP TABLE `TrackerTypeModel`;
DROP TABLE `TrackerType`;

-- CreateTable (endpoint correcto: devices/tracker/list)
CREATE TABLE `Tracker` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uid` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `imei` VARCHAR(191) NULL,
    `trackerTypeUid` VARCHAR(191) NULL,
    `trackerTypeName` VARCHAR(191) NULL,
    `unitModelUid` VARCHAR(191) NULL,
    `unitModelName` VARCHAR(191) NULL,
    `simUid` VARCHAR(191) NULL,
    `activationCode` VARCHAR(191) NULL,
    `createdDateTimeUtc` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Tracker_uid_key`(`uid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
