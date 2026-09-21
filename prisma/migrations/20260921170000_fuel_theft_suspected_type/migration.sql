-- FUEL_THEFT_SUSPECTED: caída significativa de combustible con el
-- motor apagado (vs. consumo normal, que ocurre con el motor
-- encendido) — propuesta de arquitectura del usuario, 2026-09-21.
-- matchSystemName NULL a propósito: se detecta cruzando
-- SensorReadingsList (Nivel de Combustible) con Position.ignition,
-- no una señal de InputOutputs.
INSERT INTO `CriticalAlertType` (`code`, `name`, `description`, `matchSystemName`, `active`, `createdAt`, `updatedAt`) VALUES
  ('FUEL_THEFT_SUSPECTED', 'Posible extracción de combustible', 'Caída significativa de nivel de combustible con el motor apagado — no explicada por consumo normal.', NULL, 1, NOW(3), NOW(3));
