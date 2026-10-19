/**
 * Cliente de la API "v2" de 3Dtracking (apiv2.3dtracking.net) —
 * distinta de partnerapi.3dtracking.net (tracking.client.ts): mismo
 * usuario/clave (TRACKING3D_USER_ID_GUID / TRACKING3D_PASSWORD, ver
 * tracking.auth.ts) pero con su propia sesión (UserIdGuid/SessionId
 * independientes) y rutas en minúscula.
 *
 * Trae GET /alerts/alerts/list — el feed de TODAS las alertas
 * disparadas en la cuenta (cualquier categoría: pánico, variación de
 * sensor, geocerca, combustible, etc.), no solo las que alguien
 * configuró como webhook — confirmado con datos reales 2026-10-09
 * (trajo alertas de batería que nunca llegaron por webhook). No
 * existe en partnerapi (se probó GET units/alertlist ahí y dio
 * ErrorCode 50021 "no access a esa funcionalidad").
 *
 * Inestabilidad conocida: el endpoint alerts/list devuelve a veces
 * ErrorCode 50000 "Column name or number of supplied values does not
 * match table definition" — parece un bug del lado de 3Dtracking (se
 * reprodujo repetidas veces incluso sin StartUID). El scan service
 * trata esto como fallo transitorio: se salta el ciclo y reintenta en
 * el próximo, sin romper nada.
 */

const REQUEST_TIMEOUT_MS = 15000;

export interface Alerts3DSession {
  userIdGuid: string;
  sessionId: string;
}

export interface Alerts3DAlert {
  AlertUID: string | null;
  AlertName: string | null;
  AlertType: string | null;
  AlertTypeUID: string | null;
  Vehicle: string | null;
  CreatedDate: string | null;
  AlertMessage: string | null;
  AlertQueueId: number;
}

export interface Alerts3DListResult {
  alerts: Alerts3DAlert[];
  nextStartUid: string | null;
}

async function fetchWithTimeout(url: string): Promise<Response> {

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {

    return await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

  } finally {

    clearTimeout(timeout);
  }
}

export class Alerts3DClient {

  private readonly baseUrl: string;
  private readonly userIdGuid: string;
  private readonly password: string;

  constructor() {

    this.baseUrl =
      process.env.TRACKING3D_ALERTS_BASE_URL || "https://apiv2.3dtracking.net/api/v1.0";

    this.userIdGuid = process.env.TRACKING3D_USER_ID_GUID || "";
    this.password = process.env.TRACKING3D_PASSWORD || "";

    if (!this.userIdGuid || !this.password) {
      throw new Error("TRACKING3D_USER_ID_GUID and TRACKING3D_PASSWORD are required");
    }
  }

  async authenticate(): Promise<Alerts3DSession> {

    const params = new URLSearchParams({
      UserName: this.userIdGuid,
      Password: this.password
    });

    const response = await fetchWithTimeout(
      `${this.baseUrl}/authentication/userauthenticate?${params.toString()}`
    );

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`3Dtracking alerts API auth failed: HTTP ${response.status} - ${text}`);
    }

    const data = JSON.parse(text);

    if (data?.Status?.Result !== "ok" || !data?.Result?.SessionId) {
      throw new Error(`3Dtracking alerts API auth error: ${text}`);
    }

    return {
      userIdGuid: data.Result.UserIdGuid,
      sessionId: data.Result.SessionId
    };
  }

  /**
   * StartUID vacío = últimas 24h, "0" = últimos 7 días (según la
   * documentación de 3Dtracking) — se pasa el StartUID devuelto por la
   * corrida anterior para traer solo lo nuevo.
   */
  async getAlertList(
    session: Alerts3DSession,
    startUid?: string | null
  ): Promise<Alerts3DListResult> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

    if (startUid) {
      params.set("StartUID", startUid);
    }

    const response = await fetchWithTimeout(
      `${this.baseUrl}/alerts/alerts/list?${params.toString()}`
    );

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`3Dtracking alerts/list HTTP ${response.status} - ${text}`);
    }

    const data = JSON.parse(text);

    if (data?.Status?.Result !== "ok") {
      throw new Error(`3Dtracking alerts/list error: ${data?.Status?.Message || text}`);
    }

    return {
      alerts: data.Result?.AlertList || [],
      nextStartUid: data.Result?.StartUID || null
    };
  }
}
