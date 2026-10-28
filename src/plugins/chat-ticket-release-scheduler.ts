import fp from "fastify-plugin";

const DEFAULT_INTERVAL_SECONDS = 1800; // 30 min
const MIN_INTERVAL_SECONDS = 300;
const STALE_HOURS = 24;

/**
 * Libera tickets reclamados sin actividad en 24h — pedido explícito
 * del usuario 2026-10-26: "después de 24 horas sin respuesta, el
 * chat o ticket se liberará para que otro agente pueda dar
 * seguimiento". Usa ChatTicket.updatedAt como proxy de "última
 * actividad" (no existe todavía un hilo de mensajes separado — eso
 * es Fase 3; cuando exista, este chequeo debería mirar el último
 * mensaje, no updatedAt del ticket).
 *
 * Solo libera tickets "abierto"/"en_progreso" — uno "resuelto" o
 * "cerrado" ya no necesita seguimiento, aunque esté asignado.
 *
 * Configurable por variables de entorno:
 * - CHAT_TICKET_RELEASE_ENABLED=false   desactiva la liberación automática
 * - CHAT_TICKET_RELEASE_INTERVAL_SECONDS=1800   cada cuánto revisar (mínimo 300)
 */
export default fp(async (app) => {

  const enabled = process.env.CHAT_TICKET_RELEASE_ENABLED !== "false";

  if (!enabled) {

    app.log.info(
      "Chat tickets: liberación automática a 24h desactivada (CHAT_TICKET_RELEASE_ENABLED=false)"
    );

    return;
  }

  const intervalSeconds = Math.max(
    parseInt(
      process.env.CHAT_TICKET_RELEASE_INTERVAL_SECONDS || String(DEFAULT_INTERVAL_SECONDS),
      10
    ) || DEFAULT_INTERVAL_SECONDS,
    MIN_INTERVAL_SECONDS
  );

  let running = false;

  const runRelease = async () => {

    if (running) {
      return;
    }

    running = true;

    try {

      const staleBefore = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);

      const result = await app.prisma.chatTicket.updateMany({
        where: {
          assignedToUserId: { not: null },
          status: { in: ["abierto", "en_progreso"] },
          updatedAt: { lt: staleBefore }
        },
        data: {
          assignedToUserId: null,
          assignedToUsername: null
        }
      });

      if (result.count > 0) {
        app.log.info(
          { liberados: result.count },
          "Chat tickets: liberados por 24h sin actividad"
        );
      }

    } catch (error) {

      app.log.error(error, "Chat tickets: falló la liberación automática");

    } finally {

      running = false;
    }
  };

  const timer = setInterval(runRelease, intervalSeconds * 1000);

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });

  app.log.info(
    `Chat tickets: liberación automática a ${STALE_HOURS}h activa, revisa cada ${intervalSeconds}s`
  );

  runRelease();
});
