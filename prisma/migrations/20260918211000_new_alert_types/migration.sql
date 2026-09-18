-- 4 tipos de alarma reales encontrados en 3Dtracking (muestreo de
-- 80,000 posiciones reales, InputOutputs.SystemName) que no estaban
-- en el catálogo. Solo se agregan al catálogo (CriticalAlertType) —
-- no se agregan a AllowedAlertType, solo PANIC_BUTTON debe vigilarse.
INSERT INTO `CriticalAlertType` (`code`, `name`, `description`, `matchSystemName`, `active`, `createdAt`, `updatedAt`) VALUES
  ('CO_PILOT_DOOR', 'Puerta del copiloto', 'Se abrió/cerró la puerta del copiloto', 'aux11', 1, NOW(3), NOW(3)),
  ('REAR_LEFT_DOOR', 'Puerta trasera izquierda', 'Se abrió/cerró la puerta trasera izquierda', 'aux12', 1, NOW(3), NOW(3)),
  ('REAR_RIGHT_DOOR', 'Puerta trasera derecha', 'Se abrió/cerró la puerta trasera derecha', 'aux13', 1, NOW(3), NOW(3)),
  ('HANDBRAKE', 'Freno de mano', 'Se activó/desactivó el freno de mano', 'aux14', 1, NOW(3), NOW(3));
