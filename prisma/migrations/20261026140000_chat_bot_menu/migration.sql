-- Motor de menú del chatbot por colas — 2026-10-26.
--
-- ChatQueue gana la configuración del menú: description (texto que
-- el bot muestra como opción), kind (principal = aparece en el menú
-- inicial; secundaria = aparece dentro de otra cola), destination
-- (cola = al elegirla muestra sus colas hijas; agentes = el ticket
-- queda en esa cola para sus agentes), parentId (cola padre de una
-- secundaria), sortOrder y active.
--
-- ChatTicket gana el estado de la conversación con el bot, y
-- ChatMessage es el hilo de mensajes del ticket. ChatBotConfig es una
-- sola fila (id=1) con los textos fijos del bot.

ALTER TABLE ChatQueue
  ADD COLUMN description TEXT NULL,
  ADD COLUMN kind        VARCHAR(191) NOT NULL DEFAULT 'principal',
  ADD COLUMN destination VARCHAR(191) NOT NULL DEFAULT 'agentes',
  ADD COLUMN parentId    INT NULL,
  ADD COLUMN sortOrder   INT NOT NULL DEFAULT 0,
  ADD COLUMN active      BOOLEAN NOT NULL DEFAULT true,
  ADD INDEX ChatQueue_parentId_idx (parentId);

ALTER TABLE ChatTicket
  ADD COLUMN botStatus      VARCHAR(191) NULL,
  ADD COLUMN botMenuQueueId INT NULL;

CREATE TABLE ChatMessage (
  id             INT NOT NULL AUTO_INCREMENT,
  ticketId       INT NOT NULL,
  senderType     VARCHAR(191) NOT NULL,
  senderUserId   INT NULL,
  senderUsername VARCHAR(191) NULL,
  body           TEXT NOT NULL,
  createdAt      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX ChatMessage_ticketId_idx (ticketId)
);

CREATE TABLE ChatBotConfig (
  id              INT NOT NULL DEFAULT 1,
  greeting        TEXT NOT NULL,
  invalidOption   TEXT NOT NULL,
  transferMessage TEXT NOT NULL,
  updatedAt       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
);

INSERT INTO ChatBotConfig (id, greeting, invalidOption, transferMessage, updatedAt) VALUES (
  1,
  '¡Hola! Bienvenido al soporte de Dada Fleet. ¿En qué podemos ayudarte? Respondé con el número de una opción:',
  'No reconocí esa opción. Respondé con el número de una de las opciones:',
  'Gracias. Tu consulta fue enviada a {cola}; un agente te va a responder en breve.',
  CURRENT_TIMESTAMP(3)
);
