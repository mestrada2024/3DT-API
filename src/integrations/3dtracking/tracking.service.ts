import {
  Tracking3DClient
} from "./tracking.client";

import {
  Tracking3DSession
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
}
