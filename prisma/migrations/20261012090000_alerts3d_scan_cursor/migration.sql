-- Cursor para el polling de Alerts/List de la API v2 de 3Dtracking
-- (apiv2.3dtracking.net) — ver src/services/alerts3d-scan.service.ts.
CREATE TABLE Alerts3DScanCursor (
  id        INT NOT NULL,
  startUid  VARCHAR(191) NULL,
  updatedAt DATETIME(3) NOT NULL,
  PRIMARY KEY (id)
);
