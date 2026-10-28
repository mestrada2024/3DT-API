-- Tickets de soporte y FAQ — proyecto chatbot Dada Fleet, Fase 1.

CREATE TABLE ChatTicket (
  id                 INT NOT NULL AUTO_INCREMENT,
  subject            VARCHAR(191) NOT NULL,
  description        TEXT NOT NULL,
  priority           VARCHAR(191) NOT NULL DEFAULT 'normal',
  status             VARCHAR(191) NOT NULL DEFAULT 'abierto',
  companyUid         VARCHAR(191) NULL,
  unitUid            VARCHAR(191) NULL,
  requesterName      VARCHAR(191) NULL,
  requesterPhone     VARCHAR(191) NULL,
  createdByUserId    INT NULL,
  createdByUsername  VARCHAR(191) NULL,
  assignedToUserId   INT NULL,
  assignedToUsername VARCHAR(191) NULL,
  createdAt          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt          DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  INDEX ChatTicket_status_idx (status),
  INDEX ChatTicket_companyUid_idx (companyUid),
  INDEX ChatTicket_createdAt_idx (createdAt)
);

CREATE TABLE ChatFaq (
  id         INT NOT NULL AUTO_INCREMENT,
  question   VARCHAR(191) NOT NULL,
  answer     TEXT NOT NULL,
  category   VARCHAR(191) NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  createdAt  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt  DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  INDEX ChatFaq_active_idx (active),
  INDEX ChatFaq_category_idx (category)
);
