import {
  Tracking3DClient
} from "./tracking.client";

import {
  Tracking3DSession,
  Tracking3DCreateSimPayload,
  Tracking3DCreateTrackerPayload,
  Tracking3DUpdateTrackerPayload,
  Tracking3DCreateUnitPayload
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

  async getLatestPositions(options?: { lastDateReceivedUtc?: Date }) {

    return this.client.getLatestPositions(options);
  }

  async getPositionsList(
    options?: { startId?: string; uid?: string; includeInputOutputs?: boolean }
  ) {

    return this.client.getPositionsList(options);
  }

  async getSensorReadingsList(
    options?: { startId?: string; uid?: string }
  ) {

    return this.client.getSensorReadingsList(options);
  }

  async getUnitsList(session: Tracking3DSession) {

    return this.client.getUnitsList(session);
  }

  async getUnitDetail(session: Tracking3DSession, uid: string) {

    return this.client.getUnitDetail(session, uid);
  }

  async getCompanyList(session: Tracking3DSession) {

    return this.client.getCompanyList(session);
  }

  async createUnit(
    session: Tracking3DSession,
    companyUid: string,
    payload: Tracking3DCreateUnitPayload
  ) {

    return this.client.createUnit(session, companyUid, payload);
  }

  async assignTrackerToUnit(
    session: Tracking3DSession,
    unitUid: string,
    trackerUid: string
  ) {

    return this.client.assignTrackerToUnit(session, unitUid, trackerUid);
  }

  async unassignTrackerFromUnit(
    session: Tracking3DSession,
    unitUid: string,
    trackerUid: string
  ) {

    return this.client.unassignTrackerFromUnit(session, unitUid, trackerUid);
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

  async getTrackerDetail(session: Tracking3DSession, uid: string) {

    return this.client.getTrackerDetail(session, uid);
  }

  async createTracker(
    session: Tracking3DSession,
    payload: Tracking3DCreateTrackerPayload
  ) {

    return this.client.createTracker(session, payload);
  }

  async updateTracker(
    session: Tracking3DSession,
    uid: string,
    payload: Tracking3DUpdateTrackerPayload
  ) {

    return this.client.updateTracker(session, uid, payload);
  }

  async deleteTracker(
    session: Tracking3DSession,
    uid: string
  ) {

    return this.client.deleteTracker(session, uid);
  }

  async updateTrackerAttributes(
    session: Tracking3DSession,
    uid: string,
    updates: Array<{ AttributeId: number; Value: string }>
  ) {

    return this.client.updateTrackerAttributes(session, uid, updates);
  }

  async deallocateSimFromTracker(
    session: Tracking3DSession,
    trackerUid: string,
    simUid: string
  ) {

    return this.client.deallocateSimFromTracker(session, trackerUid, simUid);
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
