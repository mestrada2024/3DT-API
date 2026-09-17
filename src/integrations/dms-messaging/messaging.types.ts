export interface DmsMessagingSendPayload {
  first_name: string;
  second_name?: string;
  third_name?: string;
  last_name?: string;
  last_name2?: string;
  phone: string;
  dynamicData?: Record<string, unknown>;
  accountId: string;
  channelId?: string;
  templateId: string;
  templateBody?: Record<string, string>;
  botData?: {
    close_ticket_in?: number;
  };
  customEvent?: string;
  closed?: boolean;
  /**
   * No documentados en el PDF fuente (Documentacion_endpoint_envio_msj.pdf)
   * — confirmados por el usuario directamente con DMS SMART:
   * - type: "notification" permite enviar el mensaje aunque ya haya
   *   una conversación en curso con ese número (evita el 403
   *   "Conversation in progress" del envío normal).
   * - track_id: id de seguimiento de la campaña, según el comentario
   *   del ejemplo original — probablemente un string libre que uno
   *   mismo genera para correlacionar el envío en sus propios
   *   sistemas (sin confirmar el formato exacto).
   */
  type?: string;
  track_id?: string;
}

export interface DmsMessagingSendResult {
  httpStatus: number;
  success: boolean;
  message?: string;
  error?: string;
}
