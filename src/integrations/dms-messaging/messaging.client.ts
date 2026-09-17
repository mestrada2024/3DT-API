import {
  DmsMessagingSendPayload,
  DmsMessagingSendResult
} from "./messaging.types";

const REQUEST_TIMEOUT_MS = 15000;

/**
 * Cliente del endpoint de campaña saliente de DMS SMART
 * (POST {host}/api/message/send/, Basic Auth) — ver
 * docs/dms-messaging.md. La ruta real, confirmada con datos reales,
 * es distinta a la documentada en el PDF fuente
 * ({{host}}/core-api/api/message/send, que devuelve 405/timeout) —
 * el host correcto es dada-websocket.dms-smart.cloud, no
 * dada.dms-smart.cloud.
 *
 * A diferencia de la integración con 3Dtracking, este endpoint
 * devuelve su propio cuerpo {success, message|error} tanto en éxito
 * como en los rechazos esperados (plantilla no encontrada,
 * conversación ya abierta, falta el cuerpo de la plantilla) — por eso
 * no se lanza excepción en esos casos, se devuelve el resultado tal
 * cual para que el llamador decida.
 *
 * Timeout explícito: se confirmó en pruebas reales que el host
 * incorrecto se quedaba sin responder indefinidamente — sin este
 * timeout, fetch() se cuelga y bloquea la petición completa de este
 * API. Se mantiene como salvaguarda aunque ya se encontró el host
 * correcto.
 */
export class DmsMessagingClient {

  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;

  constructor() {

    this.baseUrl =
      process.env.DMS_MESSAGING_BASE_URL || "";

    this.username =
      process.env.DMS_MESSAGING_USERNAME || "";

    this.password =
      process.env.DMS_MESSAGING_PASSWORD || "";

    if (!this.baseUrl) {

      throw new Error(
        "DMS_MESSAGING_BASE_URL is required"
      );
    }

    if (!this.username || !this.password) {

      throw new Error(
        "DMS_MESSAGING_USERNAME and DMS_MESSAGING_PASSWORD are required"
      );
    }
  }

  async sendMessage(
    payload: DmsMessagingSendPayload
  ): Promise<DmsMessagingSendResult> {

    const url =
      `${this.baseUrl}/api/message/send/`;

    const basicAuth =
      Buffer.from(`${this.username}:${this.password}`).toString("base64");

    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

    let response: Response;

    try {

      response =
        await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

    } catch (error) {

      if ((error as { name?: string })?.name === "AbortError") {

        throw new Error(
          `DMS SMART message/send timed out after ${REQUEST_TIMEOUT_MS}ms (sin respuesta del backend)`
        );
      }

      throw error;

    } finally {

      clearTimeout(timeout);
    }

    const responseText =
      await response.text();

    let data: { success?: boolean; message?: string; error?: string } = {};

    try {

      data = responseText ? JSON.parse(responseText) : {};

    } catch {

      throw new Error(
        `Invalid JSON from DMS SMART message/send: HTTP ${response.status} - ${responseText}`
      );
    }

    return {
      httpStatus: response.status,
      success: Boolean(data.success),
      message: data.message,
      error: data.error
    };
  }
}
