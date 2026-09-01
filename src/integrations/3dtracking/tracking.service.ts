import {
  Tracking3DClient
} from "./tracking.client";

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
}
