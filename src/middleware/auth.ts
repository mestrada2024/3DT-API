import { FastifyRequest, FastifyReply } from "fastify";

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {

    await request.jwtVerify();

  } catch {
    return reply.code(401).send({
      success: false,
      error: "Unauthorized"
    });
  }
}
