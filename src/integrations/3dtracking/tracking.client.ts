import {
  Tracking3DAuth
} from "./tracking.auth";

import {
  Tracking3DSession,
  Tracking3DUnitListItem,
  Tracking3DUnitDetail,
  Tracking3DSimCard,
  Tracking3DCreateSimPayload
} from "./tracking.types";

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

    return data.Result;
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
  }

  async getLatestPositions(): Promise<any> {

    const session =
      await this.authenticate();

    const params = new URLSearchParams({
      UserIdGuid: session.userIdGuid,
      SessionId: session.sessionId
    });

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

    try {

      return JSON.parse(responseText);

    } catch {

      throw new Error(
        `Invalid JSON from LatestPositionsList: ${responseText}`
      );
    }
  }
}
