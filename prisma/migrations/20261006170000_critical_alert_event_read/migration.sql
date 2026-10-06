-- Agrega marcado de "leído" a CriticalAlertEvent para el nuevo módulo
-- de Alertas del frontend (ver AlertsView.tsx) — permite que un
-- usuario marque una alerta como vista sin afectar whatsappStatus
-- (son conceptos independientes: una alerta puede estar leída y sin
-- enviar WhatsApp, o enviada y sin leer).
ALTER TABLE CriticalAlertEvent
  ADD COLUMN `read` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN readAt DATETIME(3) NULL;

CREATE INDEX CriticalAlertEvent_read_idx ON CriticalAlertEvent (`read`);
