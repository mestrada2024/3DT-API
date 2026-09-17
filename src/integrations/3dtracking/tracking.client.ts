import {
  Tracking3DAuth
} from "./tracking.auth";

import {
  Tracking3DSession,
  Tracking3DUnitListItem,
  Tracking3DUnitDetail,
  Tracking3DSimCard,
  Tracking3DCreateSimPayload,
  Tracking3DTracker,
  Tracking3DTrackerDetail,
  Tracking3DCreateTrackerPayload,
  Tracking3DUpdateTrackerPayload,
  Tracking3DCompany,
  Tracking3DCreateUnitPayload
} from "./tracking.types";

const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

/**
 * 3Dtracking espera "dd MMM yyyy HH:mm:ss" en UTC para
 * LastDateReceivedUtc (ej: "21 May 2013 18:14:56").
 */
export function formatTracking3DDateUtc(date: Date): string {

  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mmm = MONTH_ABBREVIATIONS[date.getUTCMonth()];
  const yyyy = date.getUTCFullYear();
  const HH = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");

  return `${dd} ${mmm} ${yyyy} ${HH}:${mm}:${ss}`;
}

export class Tracking3DClient {

  private readonly baseUrl: string;
  private readonly auth: Tracking3DAuth;

  constructor() {

    this.baseUrl =
      process.env.TRACKING3D_BASE_URL || "";

    if (!this.baseUrl) {
      throw new Error(
        "TRACKING3D_BASE_URL is required"
      );
    }

    this.auth =
      new Tracking3DAuth();
  }

  async authenticate(): Promise<Tracking3DSession> {

    return this.auth.authenticate();
  }

  async getUnitsList(
    session: Tracking3DSession
  ): Promise<Tracking3DUnitListItem[]> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

    const url =
      `${this.baseUrl}/Units/List?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking Units/List failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    return data.Result;
  }

  async getCompanyList(
    session: Tracking3DSession
  ): Promise<Tracking3DCompany[]> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

    const url =
      `${this.baseUrl}/company/list?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking company/list failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    return data.Result || [];
  }

  async createUnit(
    session: Tracking3DSession,
    companyUid: string,
    payload: Tracking3DCreateUnitPayload
  ): Promise<Tracking3DUnitDetail> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId,
      Name: payload.Name,
      GroupName: payload.GroupName || "",
      UnitFunction: payload.UnitFunction || "",
      TrackerUid: payload.TrackerUid || ""
    });

    const url =
      `${this.baseUrl}/company/${companyUid}/unitcreate?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking company/{Uid}/unitcreate failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    if (!data.Result || !data.Result.Uid) {

      throw new Error(
        `3Dtracking company/{Uid}/unitcreate no devolvió una unidad válida: ${responseText}`
      );
    }

    return data.Result;
  }

  async assignTrackerToUnit(
    session: Tracking3DSession,
    unitUid: string,
    trackerUid: string
  ): Promise<void> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId,
      UnitUid: unitUid,
      TrackerUid: trackerUid
    });

    const url =
      `${this.baseUrl}/units/assigntracker?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking units/assigntracker failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    if (data.Result !== true) {

      throw new Error(
        `3Dtracking units/assigntracker failed: ${responseText}`
      );
    }
  }

  async unassignTrackerFromUnit(
    session: Tracking3DSession,
    unitUid: string,
    trackerUid: string
  ): Promise<void> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId,
      UnitUid: unitUid,
      TrackerUid: trackerUid
    });

    const url =
      `${this.baseUrl}/units/unassigntracker?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking units/unassigntracker failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    if (data.Result !== true) {

      throw new Error(
        `3Dtracking units/unassigntracker failed: ${responseText}`
      );
    }
  }

  async getUnitDetail(
    session: Tracking3DSession,
    uid: string
  ): Promise<Tracking3DUnitDetail> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

    const url =
      `${this.baseUrl}/Units/${uid}?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking Units/{Uid} failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    return data.Result;
  }

  async getSimList(
    session: Tracking3DSession
  ): Promise<Tracking3DSimCard[]> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

    const url =
      `${this.baseUrl}/Devices/Sim/List?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking Devices/Sim/List failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    return data.Result || [];
  }

  async getTrackerList(
    session: Tracking3DSession
  ): Promise<Tracking3DTracker[]> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

    const url =
      `${this.baseUrl}/devices/tracker/list?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking devices/tracker/list failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    return data.Result || [];
  }

  /**
   * 3Dtracking devuelve HTTP 200 con Result "vacío" (todos los campos
   * en null, incluido Uid) cuando el tracker no existe, en vez de un
   * 404. Se trata como "no encontrado" (null) en ambos casos: sin
   * Result, o con Result.Uid null.
   */
  async getTrackerDetail(
    session: Tracking3DSession,
    uid: string
  ): Promise<Tracking3DTrackerDetail | null> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

    const url =
      `${this.baseUrl}/devices/tracker/${uid}/get?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking devices/tracker/{Uid}/get failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    if (!data.Result || !data.Result.Uid) {
      return null;
    }

    return data.Result;
  }

  async createTracker(
    session: Tracking3DSession,
    payload: Tracking3DCreateTrackerPayload
  ): Promise<Tracking3DTrackerDetail> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId,
      Name: payload.Name || "",
      IMEI: payload.IMEI,
      TrackerTypeUid: payload.TrackerTypeUid || "",
      UnitModelUid: payload.UnitModelUid || "",
      SimUid: payload.SimUid || ""
    });

    const url =
      `${this.baseUrl}/devices/tracker/create?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking devices/tracker/create failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    if (!data.Result || !data.Result.Uid) {

      throw new Error(
        `3Dtracking devices/tracker/create no devolvió un tracker válido: ${responseText}`
      );
    }

    return data.Result;
  }

  async createSim(
    session: Tracking3DSession,
    payload: Tracking3DCreateSimPayload
  ): Promise<Tracking3DSimCard> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId,
      PhoneNumber: payload.PhoneNumber || "",
      Pin: payload.PIN || "",
      PUK: payload.PUK || "",
      ICCID: payload.ICCID
    });

    const url =
      `${this.baseUrl}/devices/sim/create?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking devices/sim/create failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    if (!data.Result) {

      throw new Error(
        `3Dtracking devices/sim/create no devolvió un SIM válido: ${responseText}`
      );
    }

    return data.Result;
  }

  async updateSim(
    session: Tracking3DSession,
    uid: string,
    payload: Tracking3DCreateSimPayload
  ): Promise<Tracking3DSimCard> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId,
      PhoneNumber: payload.PhoneNumber || "",
      Pin: payload.PIN || "",
      PUK: payload.PUK || "",
      ICCID: payload.ICCID
    });

    const url =
      `${this.baseUrl}/devices/sim/${uid}/update?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking devices/sim/{Uid}/update failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    if (!data.Result) {

      throw new Error(
        `3Dtracking devices/sim/{Uid}/update no devolvió un SIM válido: ${responseText}`
      );
    }

    return data.Result;
  }

  /**
   * A diferencia del resto de los endpoints, la respuesta no viene
   * envuelta en { Status, Result }: el objeto de arriba (Result como
   * "ok"/"Error", ErrorCode, Message) ES la respuesta completa. No
   * hay datos del tracker en la respuesta, solo confirmación.
   */
  async updateTracker(
    session: Tracking3DSession,
    uid: string,
    payload: Tracking3DUpdateTrackerPayload
  ): Promise<void> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId,
      Name: payload.Name || "",
      IMEI: payload.IMEI || "",
      SimUid: payload.SimUid || ""
    });

    const url =
      `${this.baseUrl}/devices/tracker/${uid}/update?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking devices/tracker/{Uid}/update failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    if (data.Result !== "ok") {

      throw new Error(
        `3Dtracking devices/tracker/{Uid}/update failed: ${data.Message || responseText}`
      );
    }
  }

  /**
   * Misma respuesta plana que updateTracker (sin envoltura Status):
   * { Result, ErrorCode, Message }, Result "ok" en éxito.
   */
  async deleteTracker(
    session: Tracking3DSession,
    uid: string
  ): Promise<void> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

    const url =
      `${this.baseUrl}/devices/tracker/${uid}/delete?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking devices/tracker/{Uid}/delete failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    if (data.Result !== "ok") {

      throw new Error(
        `3Dtracking devices/tracker/{Uid}/delete failed: ${data.Message || responseText}`
      );
    }
  }

  async deleteSim(
    session: Tracking3DSession,
    uid: string
  ): Promise<void> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

    const url =
      `${this.baseUrl}/devices/sim/${uid}/delete?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking devices/sim/{Uid}/delete failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    if (data.Result !== "ok") {

      throw new Error(
        `3Dtracking devices/sim/{Uid}/delete failed: ${data.Message || responseText}`
      );
    }
  }

  /**
   * Misma respuesta plana que updateTracker/deleteTracker (sin
   * envoltura Status): { Result, ErrorCode, Message }, Result "ok" en
   * éxito. No borra el SIM ni el tracker, solo cierra la asignación
   * entre ambos.
   */
  async deallocateSimFromTracker(
    session: Tracking3DSession,
    trackerUid: string,
    simUid: string
  ): Promise<void> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId,
      SimUid: simUid
    });

    const url =
      `${this.baseUrl}/devices/tracker/${trackerUid}/deallocatesim?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking devices/tracker/{Uid}/deallocatesim failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    if (data.Result !== "ok") {

      throw new Error(
        `3Dtracking devices/tracker/{Uid}/deallocatesim failed: ${data.Message || responseText}`
      );
    }
  }

  /**
   * Aplica varios atributos a la vez (a diferencia de
   * updateUnitAttribute, que siempre manda un arreglo de un solo
   * elemento). Misma respuesta plana que update/delete/deallocate.
   */
  async updateTrackerAttributes(
    session: Tracking3DSession,
    uid: string,
    updates: Array<{ AttributeId: number; Value: string }>
  ): Promise<void> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

    const url =
      `${this.baseUrl}/devices/tracker/${uid}/attributes/update?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(updates)
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking devices/tracker/{Uid}/attributes/update failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    if (data.Result !== "ok") {

      throw new Error(
        `3Dtracking devices/tracker/{Uid}/attributes/update failed: ${data.Message || responseText}`
      );
    }
  }

  async updateUnitAttribute(
    session: Tracking3DSession,
    uid: string,
    attributeId: number,
    value: string
  ): Promise<void> {

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

    const url =
      `${this.baseUrl}/Units/${uid}/Attributes/Update?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify([
          {
            AttributeId: attributeId,
            Value: value
          }
        ])
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking Attributes/Update failed: HTTP ${response.status} - ${responseText}`
      );
    }

    const data = JSON.parse(responseText);

    if (data.Result !== "ok") {

      throw new Error(
        `3Dtracking Attributes/Update failed: ${data.Message || responseText}`
      );
    }
  }

  async getLatestPositions(
    options?: { lastDateReceivedUtc?: Date }
  ): Promise<any> {

    const session =
      await this.authenticate();

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

    if (options?.lastDateReceivedUtc) {

      params.set(
        "LastDateReceivedUtc",
        formatTracking3DDateUtc(options.lastDateReceivedUtc)
      );
    }

    const url =
      `${this.baseUrl}/Units/LatestPositionsList?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking LatestPositionsList failed: HTTP ${response.status} - ${responseText}`
      );
    }

    let data: any;

    try {

      data = JSON.parse(responseText);

    } catch {

      throw new Error(
        `Invalid JSON from LatestPositionsList: ${responseText}`
      );
    }

    if (data?.Status?.Result && data.Status.Result !== "ok") {

      throw new Error(
        `3Dtracking Units/LatestPositionsList failed: ${data.Status.Message || data.Status.ErrorCode}`
      );
    }

    return data;
  }

  /**
   * Data/PositionsList: stream cronológico (todas las unidades) paginado
   * por StartId, a diferencia de Units/LatestPositionsList (solo la
   * posición más reciente por unidad). Necesario para no perder señales
   * puntuales como el botón de pánico, que 3Dtracking reporta como
   * Active:true solo en el mensaje exacto del evento y luego vuelve a
   * Active:false en el siguiente reporte de posición.
   */
  async getPositionsList(
    options: {
      startId?: string;
      uid?: string;
      includeInputOutputs?: boolean;
    } = {}
  ): Promise<any> {

    const session =
      await this.authenticate();

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

    if (options.startId !== undefined) {
      params.set("StartId", options.startId);
    }

    if (options.uid) {
      params.set("Uid", options.uid);
    }

    if (options.includeInputOutputs !== undefined) {
      params.set(
        "IncludeInputOutputs",
        options.includeInputOutputs ? "true" : "false"
      );
    }

    const url =
      `${this.baseUrl}/data/positionslist?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking data/positionslist failed: HTTP ${response.status} - ${responseText}`
      );
    }

    let data: any;

    try {

      data = JSON.parse(responseText);

    } catch {

      throw new Error(
        `Invalid JSON from data/positionslist: ${responseText}`
      );
    }

    if (data?.Status?.Result && data.Status.Result !== "ok") {

      throw new Error(
        `3Dtracking data/positionslist failed: ${data.Status.Message || data.Status.ErrorCode}`
      );
    }

    return data;
  }

  /**
   * Data/SensorReadingsList: stream cronológico (todas las unidades)
   * paginado por StartId, igual que data/positionslist pero con
   * lecturas de sensores (batería, GSM, satélites, etc.) en vez de
   * posiciones. Es la fuente real de batería — Units/LatestPositionsList
   * también trae SensorReadings, pero es el mismo endpoint que se
   * bloqueó por límite de tasa (ver critical-alert.service.ts); este
   * stream no mostró ese problema.
   */
  async getSensorReadingsList(
    options: { startId?: string; uid?: string } = {}
  ): Promise<any> {

    const session =
      await this.authenticate();

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

    if (options.startId !== undefined) {
      params.set("StartId", options.startId);
    }

    if (options.uid) {
      params.set("Uid", options.uid);
    }

    const url =
      `${this.baseUrl}/data/sensorreadingslist?${params.toString()}`;

    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

    const responseText =
      await response.text();

    if (!response.ok) {

      throw new Error(
        `3Dtracking data/sensorreadingslist failed: HTTP ${response.status} - ${responseText}`
      );
    }

    let data: any;

    try {

      data = JSON.parse(responseText);

    } catch {

      throw new Error(
        `Invalid JSON from data/sensorreadingslist: ${responseText}`
      );
    }

    if (data?.Status?.Result && data.Status.Result !== "ok") {

      throw new Error(
        `3Dtracking data/sensorreadingslist failed: ${data.Status.Message || data.Status.ErrorCode}`
      );
    }

    return data;
  }
}
