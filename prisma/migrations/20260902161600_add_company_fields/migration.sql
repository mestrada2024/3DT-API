-- AlterTable
ALTER TABLE `Unit` ADD COLUMN `companyUid` VARCHAR(191) NULL AFTER `name`;
ALTER TABLE `Unit` ADD COLUMN `companyName` VARCHAR(191) NULL AFTER `companyUid`;
