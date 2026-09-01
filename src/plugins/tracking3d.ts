import fp from "fastify-plugin";
import { Tracking3DService } from "../services/tracking3d";

declare module "fastify" {
  interface FastifyInstance {
    tracking3d: Tracking3DService;
  }
}

export default fp(async (app) => {

  const tracking3d = new Tracking3DService();

  app.decorate("tracking3d", tracking3d);

});
