-- Campo de WhatsApp en User — identidad para el chatbot Dada Fleet.
-- Obligatorio a nivel de aplicación (no DB) para admin/supervisor/user,
-- ver WHATSAPP_REQUIRED_ROLES en src/routes/users.ts.
ALTER TABLE User ADD COLUMN whatsapp VARCHAR(191) NULL;
