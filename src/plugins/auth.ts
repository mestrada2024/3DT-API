import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: number;
      username: string;
      role: string;
    };
    user: {
      sub: number;
      username: string;
      role: string;
    };
  }
}

export default fp(async (app) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }

  await app.register(fastifyJwt, {
    secret,
    sign: {
      expiresIn: process.env.JWT_EXPIRES_IN || "8h"
    }
  });
});
