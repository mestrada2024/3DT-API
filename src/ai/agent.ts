import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

import { Tracking3DService } from "../integrations/3dtracking/tracking.service";

import {
  resolveCompanyByPhone,
  getVehicleLocation,
  getVehicleStatus,
  getFuelLevel,
  getVehicleAlerts,
  getVehicleTrips
} from "./tools";

const MODEL = "claude-opus-5";
const MAX_TOKENS = 2000;

/**
 * Agente conversacional de WhatsApp para consultas de flota — ver
 * docs del diseño original (Agente_IA_WhatsApp_DMS_3DTracking.md).
 *
 * Estado de esta implementación (2026-09-22):
 * - Fase 1-3 del documento (backend + integración 3Dtracking + agente
 *   LLM): esta clase.
 * - Fase 4 (webhook de WhatsApp): NO implementada — pendiente de
 *   confirmar con DMS SMART si soportan webhooks de mensajes
 *   ENTRANTES (distinto del envío saliente que ya usamos). Sin eso,
 *   no hay forma de que el agente se entere cuando alguien responde.
 * - Fase 6 (contexto de conversación multi-turno): NO implementada —
 *   cada llamada a answerFleetQuestion() es una consulta aislada, sin
 *   memoria de mensajes anteriores. Se puede agregar después
 *   guardando el historial por número de teléfono.
 * - Esta clase NO está registrada en server.ts — no hay ruta ni
 *   plugin que la invoque todavía, justamente porque no existe el
 *   webhook que la dispararía. Queda lista para conectar en cuanto
 *   se resuelva el punto anterior.
 *
 * Seguridad (sección 9 del documento): la autorización ocurre ANTES
 * de invocar al LLM, no dentro — resolveCompanyByPhone() determina de
 * qué empresa es el número que escribe, y esa empresa se inyecta en
 * cada tool call. El LLM nunca decide ni ve el companyUid como texto
 * libre editable; viene cerrado en el closure de cada tool.
 */
export class FleetWhatsappAgent {

  private readonly client: Anthropic;

  constructor(private readonly tracking3d: Tracking3DService) {

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is required");
    }

    this.client = new Anthropic();
  }

  /**
   * Responde una pregunta en lenguaje natural sobre la flota de la
   * empresa asociada al número de teléfono que escribió. Devuelve
   * null si el número no corresponde a ninguna empresa conocida — el
   * llamador decide qué hacer en ese caso (no se llega a invocar el
   * LLM).
   */
  async answerFleetQuestion(
    prisma: PrismaClient,
    fromPhone: string,
    message: string
  ): Promise<string | null> {

    const company = await resolveCompanyByPhone(prisma, fromPhone);

    if (!company) {
      return null;
    }

    const tools = this.buildTools(prisma, company.uid);

    const finalMessage = await this.client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools,
      messages: [{ role: "user", content: message }]
    });

    const textBlock = finalMessage.content.find((block) => block.type === "text");

    return textBlock && textBlock.type === "text"
      ? textBlock.text
      : "No pude generar una respuesta — intenta reformular tu pregunta.";
  }

  private buildTools(prisma: PrismaClient, companyUid: string) {

    return [

      betaZodTool({
        name: "get_vehicle_location",
        description:
          "Obtiene la ubicación (latitud/longitud), velocidad y estado actual de un vehículo por nombre o placa.",
        inputSchema: z.object({
          vehicleName: z.string().describe("Nombre o placa del vehículo, tal como lo escribió el usuario")
        }),
        run: async (input) => JSON.stringify(await getVehicleLocation(prisma, companyUid, input.vehicleName))
      }),

      betaZodTool({
        name: "get_vehicle_status",
        description: "Obtiene el estado (activo/inactivo), batería y última transmisión de un vehículo.",
        inputSchema: z.object({
          vehicleName: z.string().describe("Nombre o placa del vehículo")
        }),
        run: async (input) => JSON.stringify(await getVehicleStatus(prisma, companyUid, input.vehicleName))
      }),

      betaZodTool({
        name: "get_fuel_level",
        description: "Obtiene el último nivel de combustible conocido de un vehículo, en galones.",
        inputSchema: z.object({
          vehicleName: z.string().describe("Nombre o placa del vehículo")
        }),
        run: async (input) => JSON.stringify(await getFuelLevel(prisma, companyUid, input.vehicleName))
      }),

      betaZodTool({
        name: "get_vehicle_alerts",
        description:
          "Obtiene las alertas críticas (botón de pánico, recarga/posible robo de combustible) de un vehículo en un rango de fechas.",
        inputSchema: z.object({
          vehicleName: z.string().describe("Nombre o placa del vehículo"),
          from: z.string().describe("Fecha/hora de inicio, formato ISO 8601 (ej. 2026-09-22T00:00:00Z)"),
          to: z.string().describe("Fecha/hora de fin, formato ISO 8601")
        }),
        run: async (input) => JSON.stringify(await getVehicleAlerts(prisma, companyUid, input.vehicleName, input.from, input.to))
      }),

      betaZodTool({
        name: "get_vehicle_trips",
        description: "Obtiene los viajes/recorridos de un vehículo en una fecha específica.",
        inputSchema: z.object({
          vehicleName: z.string().describe("Nombre o placa del vehículo"),
          date: z.string().describe("Fecha en formato YYYY-MM-DD")
        }),
        run: async (input) =>
          JSON.stringify(await getVehicleTrips(prisma, this.tracking3d, companyUid, input.vehicleName, input.date))
      })

    ];
  }
}

const SYSTEM_PROMPT = `Eres el asistente de flota de Dada Fleet por WhatsApp. Respondes preguntas sobre vehículos usando ÚNICAMENTE las herramientas disponibles — nunca inventes ubicaciones, niveles de combustible, alertas o cualquier otro dato.

Reglas:
- Responde siempre en español, en un tono breve y claro, apto para WhatsApp (sin formato markdown complejo).
- Si una herramienta devuelve status "not_found", dile al usuario que no encontraste ese vehículo y que verifique el nombre.
- Si devuelve status "ambiguous", lista los nombres candidatos y pide que precise cuál.
- Si no tienes una herramienta para lo que se pregunta, dilo directamente en vez de adivinar.
- No reveles el companyUid, IDs internos, ni detalles técnicos — solo información relevante para el usuario.`;
