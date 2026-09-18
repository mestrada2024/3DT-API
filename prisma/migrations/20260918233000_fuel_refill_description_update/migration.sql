-- Actualiza la descripción de FUEL_REFILL con el hallazgo real:
-- muestreo de Data/SensorReadingsList (49,908 lecturas reales)
-- confirmó que combustible solo llega como LECTURAS continuas
-- (Nivel de Combustible, combustible_OBDII, nivel de combustible
-- copiloto/motorista, Sensor Promedio, Total Fuel Consumed, etc.),
-- nunca como un evento discreto de "recarga". La regla es calculada
-- internamente por 3Dtracking (probablemente: salto de nivel en poco
-- tiempo) y no es algo que matchSystemName pueda resolver — se
-- necesitaría un mecanismo propio que monitoree esas lecturas.
UPDATE `CriticalAlertType`
SET `description` = 'Regla calculada por 3Dtracking (no señal cruda de InputOutputs). No detectable con matchSystemName; requeriría monitorear lecturas de Nivel de Combustible y calcular saltos nosotros mismos.'
WHERE `code` = 'FUEL_REFILL';
