import { FastifyPluginAsync } from "fastify";
import bcrypt from "bcrypt";

const authRoutes: FastifyPluginAsync = async (app) => {

  app.post<{
    Body: {
      username: string;
      password: string;
    };
  }>("/login", async (request, reply) => {

    const { username, password } = request.body;

    if (!username || !password) {
      return reply.code(400).send({
        success: false,
        message: "Username and password are required"
      });
    }

    const user = await app.prisma.user.findUnique({
      where: {
        username
      }
    });

    if (!user) {
      return reply.code(401).send({
        success: false,
        message: "Invalid credentials"
      });
    }

    if (!user.active) {
      return reply.code(403).send({
        success: false,
        message: "User account is inactive"
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!validPassword) {
      return reply.code(401).send({
        success: false,
        message: "Invalid credentials"
      });
    }

    const token = await app.jwt.sign({
      sub: user.id,
      username: user.username,
      role: user.role
    });

    return reply.send({
      success: true,
      tokenType: "Bearer",
      accessToken: token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  });


  app.get("/me", {
    preHandler: async (request) => {
      await request.jwtVerify();
    }
  }, async (request) => {

    const user = await app.prisma.user.findUnique({
      where: {
        id: request.user.sub
      },
      select: {
        id: true,
        username: true,
        role: true,
        active: true
      }
    });

    if (!user) {
      return {
        success: false,
        message: "User not found"
      };
    }

    return {
      success: true,
      user
    };
  });

};

export default authRoutes;
