-- AlterTable
ALTER TABLE `CriticalAlertType` ADD COLUMN `notifyWhatsapp` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `WhatsappAlertConfig` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `accountId` VARCHAR(191) NULL,
    `channelId` VARCHAR(191) NULL,
    `templateId` VARCHAR(191) NULL,
    `templateLabel` VARCHAR(191) NULL,
    `templateText` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Catálogo completo de alertas: SystemName reales confirmados con
-- datos en vivo de 3Dtracking (InputOutputs de Units/LatestPositionsList
-- / Data/PositionsList) a lo largo de esta sesión. No existe un
-- endpoint de catálogo en 3Dtracking — esta lista es empírica.
INSERT INTO `CriticalAlertType` (`code`, `name`, `description`, `matchSystemName`, `active`, `notifyWhatsapp`, `createdAt`, `updatedAt`) VALUES
('DRIVER_DOOR', 'Puerta del motorista', 'Se abrió/cerró la puerta del conductor', 'aux10', true, false, NOW(3), NOW(3)),
('ACCIDENT', 'Accidente', 'El dispositivo detectó un posible accidente', 'accident', true, false, NOW(3), NOW(3)),
('OVERSPEEDING', 'Exceso de velocidad', 'La unidad superó el límite de velocidad configurado', 'overspeeding', true, false, NOW(3), NOW(3)),
('EXCESSIVE_ACCELERATION', 'Aceleración brusca', 'Aceleración excesiva detectada', 'excessiveacceleration', true, false, NOW(3), NOW(3)),
('EXCESSIVE_DECELERATION', 'Frenado brusco', 'Frenado/deceleración excesiva detectada', 'excessivedeceleration', true, false, NOW(3), NOW(3)),
('EXCESSIVE_LATERAL_G', 'Giro brusco', 'Fuerza lateral excesiva (curva tomada muy rápido)', 'excessivelateralg', true, false, NOW(3), NOW(3)),
('ALARM', 'Alarma del vehículo', 'Alarma del vehículo activada', 'alarm', true, false, NOW(3), NOW(3)),
('EXTERNAL_POWER_FAILURE', 'Falla de energía externa', 'Se perdió la alimentación eléctrica externa del dispositivo (posible desconexión de batería)', 'externalpowerfailure', true, false, NOW(3), NOW(3)),
('GPS_ANTENNA_REMOVAL', 'Remoción de antena GPS', 'Se detectó la remoción de la antena GPS', 'gpsantennaremoval', true, false, NOW(3), NOW(3)),
('UNIT_ROAMING', 'Roaming', 'La unidad está operando en roaming', 'unitroaming', true, false, NOW(3), NOW(3));
