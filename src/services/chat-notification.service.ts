import { ChatQueue, ChatTicket, PrismaClient } from "@prisma/client";

/**
 * Notificaciones internas (campana del encabezado) — pedido
 * 2026-10-27: "cuando el cliente escriba la palabra agente, que llegue
 * una notificación a los supervisores y agentes de la cola
 * seleccionada". Una fila por destinatario, así cada uno la marca
 * leída por su cuenta.
 */

export const NOTIFICATION_AGENT_REQUEST = "agent_request";

const QUEUE_ROLES = ["user", "supervisor"];

/**
 * Avisa a los agentes y supervisores activos de la cola. Si la cola no
 * tiene ninguno, avisa a root/admin para que el pedido no se pierda
 * (caso real al implementarlo: la cola "Prueba" solo tenía
 * asignaciones de usuarios ya borrados). Devuelve a quiénes avisó.
 */
export async function notifyAgentRequest(
  prisma: PrismaClient,
  ticket: ChatTicket,
  queue: ChatQueue | null
): Promise<{ userIds: number[]; fallbackToAdmins: boolean }> {

  const memberIds = queue
    ? (await prisma.userQueue.findMany({ where: { queueId: queue.id }, select: { userId: true } })).map((m) => m.userId)
    : [];

  let recipients = memberIds.length
    ? await prisma.user.findMany({
        where: { id: { in: memberIds }, active: true, role: { in: QUEUE_ROLES } },
        select: { id: true }
      })
    : [];

  const fallbackToAdmins = recipients.length === 0;

  if (fallbackToAdmins) {
    recipients = await prisma.user.findMany({
      where: { active: true, role: { in: ["root", "admin"] } },
      select: { id: true }
    });
  }

  /**
   * Último mensaje con contenido: se saltea el propio pedido ("agente")
   * y las opciones de menú ("1", "0", "menu") — en la primera prueba
   * real la notificación mostraba "Último mensaje: \"1\"".
   */
  const recentClientMessages = await prisma.chatMessage.findMany({
    where: { ticketId: ticket.id, senderType: "cliente" },
    orderBy: { id: "desc" },
    take: 10,
    select: { body: true }
  });

  const lastClientMessage = recentClientMessages
    .slice(1)
    .find((m) => !/^\s*(\d{1,2}|menu|menú|volver|opciones|inicio)\s*$/i.test(m.body));

  const queueName = queue?.name ?? "sin cola";
  const who = ticket.createdByUsername || ticket.requesterName || "Un cliente";

  const title = `${who} pidió un agente — ${queueName}`;

  const body =
    `Ticket #${ticket.id}: ${ticket.subject}` +
    (lastClientMessage ? `\nÚltimo mensaje: "${lastClientMessage.body.slice(0, 140)}"` : "") +
    (fallbackToAdmins ? `\n(La cola ${queueName} no tiene agentes ni supervisores activos asignados.)` : "");

  if (recipients.length > 0) {
    await prisma.chatNotification.createMany({
      data: recipients.map((r) => ({
        userId: r.id,
        ticketId: ticket.id,
        type: NOTIFICATION_AGENT_REQUEST,
        title,
        body
      }))
    });
  }

  return { userIds: recipients.map((r) => r.id), fallbackToAdmins };
}
