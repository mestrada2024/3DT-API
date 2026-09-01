import fp from "fastify-plugin";

export default fp(async (app) => {
  app.decorate("authenticate", async function (request, reply) {
    await request.jwtVerify();
  });
});
