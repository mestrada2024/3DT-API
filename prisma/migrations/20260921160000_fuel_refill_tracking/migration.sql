-- Campos para detectar recargas de combustible en vivo (Data/SensorReadingsList,
-- Name="Nivel de Combustible") sin depender del módulo de Alertas de
-- 3Dtracking (bloqueado por permisos, ErrorCode 50021 en esta cuenta).
ALTER TABLE `Unit`
  ADD COLUMN `lastFuelLevel` DECIMAL(8,2) NULL,
  ADD COLUMN `lastFuelLevelAt` DATETIME(3) NULL,
  ADD COLUMN `fuelRefillThresholdGallons` DECIMAL(8,2) NULL;
