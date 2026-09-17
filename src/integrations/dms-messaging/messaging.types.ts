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
}

export interface DmsMessagingSendResult {
  httpStatus: number;
  success: boolean;
  message?: string;
  error?: string;
}
