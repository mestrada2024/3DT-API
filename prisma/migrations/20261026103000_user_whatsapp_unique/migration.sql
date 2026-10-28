-- Corrección: whatsapp es la clave para vincular mensajes entrantes
-- a la cuenta del cliente — debe ser único.
ALTER TABLE User ADD UNIQUE INDEX User_whatsapp_key (whatsapp);
