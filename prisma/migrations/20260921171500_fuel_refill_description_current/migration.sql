-- FUEL_REFILL ya es detectable (unit-live-status.service.ts,
-- processFuelReading) — actualiza la descripción que decía "no
-- detectable con matchSystemName", desactualizada desde que se
-- construyó la detección vía SensorReadingsList.
UPDATE `CriticalAlertType`
SET `description` = 'Detectado comparando lecturas de Nivel de Combustible (sube >= umbral por unidad, default 5 gal). No usa matchSystemName.'
WHERE `code` = 'FUEL_REFILL';
