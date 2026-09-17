-- CreateTable
CREATE TABLE `CriticalAlertType` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CriticalAlertType_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed: alerta de botón de pánico
INSERT INTO `CriticalAlertType` (`code`, `name`, `description`, `active`, `updatedAt`)
VALUES ('PANIC_BUTTON', 'Botón de pánico', 'El conductor activó el botón de pánico del dispositivo', true, CURRENT_TIMESTAMP(3));
