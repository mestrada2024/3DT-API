import fp from "fastify-plugin";

import {
  DmsMessagingClient
} from "../integrations/dms-messaging/messaging.client";

declare module "fastify" {

  interface FastifyInstance {

    dmsMessaging:
      DmsMessagingClient;

  }
}

export default fp(
  async (app) => {

    const dmsMessaging =
      new DmsMessagingClient();

    app.decorate(
      "dmsMessaging",
      dmsMessaging
    );

  }
);
