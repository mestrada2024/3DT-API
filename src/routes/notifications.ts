import { FastifyPluginAsync } from "fastify";

interface NotificationIdParams {
  id: string;
}

const LIST_LIMIT = 30;

/**
 * Notificaciones internas del usuario logueado (campana del
 * encabezado) — ver chat-notification.service.ts. Cada usuario ve y
 * marca solo las suyas.
 */
const notificationsRoutes: FastifyPluginAsync = async (app) => {

  /**
   * GET /api/v1/notifications — las últimas 30 + cantidad sin leer.
   */
  app.get(
    "/notifications",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      try {

        const userId = request.user.sub;

        const [items, unread] = await Promise.all([
          app.prisma.chatNotification.findMany({
            where: { userId },
            orderBy: { id: "desc" },
            take: LIST_LIMIT
          }),
          app.prisma.chatNotification.count({ where: { userId, readAt: null } })
        ]);

        return reply.send({ success: true, data: { items, unread } });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error obteniendo las notificaciones"
        });
      }
    }
  );

  /**
   * POST /api/v1/notifications/:id/read
   */
  app.post<{
    Params: NotificationIdParams;
  }>(
    "/notifications/:id/read",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      const id = parseInt(request.params.id, 10);

      if (isNaN(id)) {
        return reply.code(400).send({ success: false, error: "INVALID_ID", message: "id inválido" });
      }

      try {

        const result = await app.prisma.chatNotification.updateMany({
          where: { id, userId: request.user.sub, readAt: null },
          data: { readAt: new Date() }
        });

        return reply.send({ success: true, data: { updated: result.count } });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error marcando la notificación"
        });
      }
    }
  );

  /**
   * POST /api/v1/notifications/read-all
   */
  app.post(
    "/notifications/read-all",
    {
      preHandler: async (request) => {
        await request.jwtVerify();
      }
    },
    async (request, reply) => {

      try {

        const result = await app.prisma.chatNotification.updateMany({
          where: { userId: request.user.sub, readAt: null },
          data: { readAt: new Date() }
        });

        return reply.send({ success: true, data: { updated: result.count } });

      } catch (error) {

        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "Error marcando las notificaciones"
        });
      }
    }
  );

};

export default notificationsRoutes;
