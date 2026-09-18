-- "Recarga de combustible telemetria" — regla de negocio configurada
-- en el panel de 3Dtracking (no una señal fija de InputOutputs, según
-- captura de pantalla del usuario: tipo "Nivel de combustible
-- (Recarga)", creada por Omar Leiva, vigente 24 Aug 2026 - 24 Aug
-- 2036, Activo). matchSystemName queda NULL a propósito — no se pudo
-- confirmar el identificador técnico real porque Units/AlertsList
-- (el endpoint que listaría esto) devuelve
-- "Youdonothaveaccesstothisfunctionality" (ErrorCode 50021) para esta
-- cuenta. Con matchSystemName NULL el escáner no la vigila (mismo
-- comportamiento que cualquier tipo sin matchSystemName) hasta que se
-- confirme el valor real.
INSERT INTO `CriticalAlertType` (`code`, `name`, `description`, `matchSystemName`, `active`, `createdAt`, `updatedAt`) VALUES
  ('FUEL_REFILL', 'Recarga de combustible telemetría', 'Nivel de combustible (Recarga) — regla configurada en 3Dtracking por Omar Leiva. Identificador técnico (matchSystemName) sin confirmar: Units/AlertsList no está habilitado para esta cuenta.', NULL, 1, NOW(3), NOW(3));
