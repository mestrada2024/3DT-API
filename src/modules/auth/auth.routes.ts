import { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";

export async function authRoutes(app: FastifyInstance) {

  app.post("/login", async (request, reply) => {

    const body = request.body as {
      username?: string;
      password?: string;
    };

    if (!body.username || !body.password) {
      return reply.code(400).send({
        success: false,
        error: "Username and password are required"
      });
    }

    const user = await app.prisma.user.findUnique({
      where: {
        username: body.username
      }
    });

    if (!user || !user.active) {
      return reply.code(401).send({
        success: false,
        error: "Invalid credentials"
      });
    }

    const validPassword = await bcrypt.compare(
      body.password,
      user.passwordHash
    );

    if (!validPassword) {
      return reply.code(401).send({
        success: false,
        error: "Invalid credentials"
      });
    }

    const token = app.jwt.sign({
      sub: user.id,
      username: user.username,
      role: user.role
    });

    return {
      success: true,
      data: {
        accessToken: token,
        tokenType: "Bearer",
        expiresIn: process.env.JWT_EXPIRES_IN || "8h",
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        }
      }
    };
  });
}
