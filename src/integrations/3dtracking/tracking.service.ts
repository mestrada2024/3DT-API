import {
  Tracking3DClient
} from "./tracking.client";

import {
  Tracking3DSession,
  Tracking3DCreateSimPayload
} from "./tracking.types";

export class Tracking3DService {

  private readonly client: Tracking3DClient;

  constructor() {

    this.client =
      new Tracking3DClient();
  }

  async authenticate() {

    return this.client.authenticate();
  }

  async getLatestPositions() {

    return this.client.getLatestPositions();
  }

  async getUnitsList(session: Tracking3DSession) {

    return this.client.getUnitsList(session);
  }

  async getUnitDetail(session: Tracking3DSession, uid: string) {

    return this.client.getUnitDetail(session, uid);
  }

  async updateUnitAttribute(
    session: Tracking3DSession,
    uid: string,
    attributeId: number,
    value: string
  ) {

    return this.client.updateUnitAttribute(session, uid, attributeId, value);
  }

  async getSimList(session: Tracking3DSession) {

    return this.client.getSimList(session);
  }

  async getTrackerList(session: Tracking3DSession) {

    return this.client.getTrackerList(session);
  }

  async createSim(
    session: Tracking3DSession,
    payload: Tracking3DCreateSimPayload
  ) {

    return this.client.createSim(session, payload);
  }

  async updateSim(
    session: Tracking3DSession,
    uid: string,
    payload: Tracking3DCreateSimPayload
  ) {

    return this.client.updateSim(session, uid, payload);
  }

  async deleteSim(
    session: Tracking3DSession,
    uid: string
  ) {

    return this.client.deleteSim(session, uid);
  }
}
