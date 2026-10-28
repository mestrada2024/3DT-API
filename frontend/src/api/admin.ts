import { API_BASE_URL, ApiError, apiRequest, getStoredToken } from "./client";

export interface Paginated<T> {
  success: boolean;
  data: T[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export interface SortParams {
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

function applySort(qs: URLSearchParams, sort?: SortParams) {
  if (sort?.sortBy) {
    qs.set("sortBy", sort.sortBy);
    qs.set("sortDir", sort.sortDir || "asc");
  }
}

// ---------- SIMs ----------

export interface Sim {
  id: number;
  iccid: string;
  phoneNumber: string | null;
  trackerUid: string | null;
  trackerName: string | null;
  externalId: string | null;
  syncStatus: string;
  syncError: string | null;
  createdAt: string;
}

export interface CreateSimBody {
  iccid: string;
  phoneNumber?: string;
  pin?: string;
  puk?: string;
  trackerUid?: string;
}

export function listSims(params: { page: number; limit: number; search?: string; unassigned?: boolean } & SortParams) {
  const qs = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
  if (params.search) qs.set("search", params.search);
  if (params.unassigned) qs.set("unassigned", "true");
  applySort(qs, params);
  return apiRequest<Paginated<Sim>>(`/api/v1/tracking/sims/local?${qs.toString()}`);
}

export function createSim(body: CreateSimBody) {
  return apiRequest<{ success: boolean; data: Sim; tracking3d: { synced: boolean; message?: string } }>(
    "/api/v1/tracking/sims",
    { method: "POST", body }
  );
}

export function deleteSim(id: string) {
  return apiRequest<{ success: boolean }>(`/api/v1/tracking/sims/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

// ---------- Trackers (GPS) ----------

export interface Tracker {
  id: number;
  uid: string | null;
  name: string | null;
  imei: string | null;
  unitModelName: string | null;
  trackerTypeName: string | null;
  simUid: string | null;
  simPhoneNumber: string | null;
  unitUid: string | null;
  syncStatus: string;
  createdAt: string;
}

export interface CreateTrackerBody {
  imei: string;
  unitModelName?: string;
}

export function listTrackers(params: { page: number; limit: number; search?: string } & SortParams) {
  const qs = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
  if (params.search) qs.set("search", params.search);
  applySort(qs, params);
  return apiRequest<Paginated<Tracker>>(`/api/v1/tracking/trackers/local?${qs.toString()}`);
}

export function createTracker(body: CreateTrackerBody) {
  return apiRequest<{ success: boolean; data: Tracker; tracking3d: { synced: boolean; message?: string } }>(
    "/api/v1/tracking/trackers",
    { method: "POST", body }
  );
}

export function deleteTracker(id: string) {
  return apiRequest<{ success: boolean }>(`/api/v1/tracking/trackers/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function assignSimToTracker(trackerId: string, iccid: string) {
  return apiRequest<{ success: boolean }>(`/api/v1/tracking/trackers/${encodeURIComponent(trackerId)}/sim`, {
    method: "POST",
    body: { iccid }
  });
}

export function listUnassignedSims() {
  return listSims({ page: 1, limit: 100, unassigned: true });
}

export function unassignSimFromTracker(trackerId: string) {
  return apiRequest<{ success: boolean }>(`/api/v1/tracking/trackers/${encodeURIComponent(trackerId)}/sim`, {
    method: "DELETE"
  });
}

// ---------- Units (vehículos) ----------

export interface Unit {
  id: number;
  externalId: string;
  name: string;
  plate: string | null;
  companyUid: string | null;
  companyName: string | null;
  status: string;
  trackerUid: string | null;
  trackerName: string | null;
}

export interface CreateUnitBody {
  companyUid: string;
  name: string;
  groupName?: string;
  unitFunction?: string;
  trackerUid?: string;
}

// ---------- Rastreo (mapa en vivo) ----------

export interface TrackingUnit {
  id: number;
  externalId: string;
  name: string;
  plate: string | null;
  companyUid: string | null;
  companyName: string | null;
  status: string;
  latitude: string | null;
  longitude: string | null;
  speed: string | null;
  lastPositionAt: string | null;
}

export function listUnitsForTracking(params: { search?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  const query = qs.toString();
  return apiRequest<{ success: boolean; data: TrackingUnit[] }>(
    `/api/v1/units/tracking${query ? `?${query}` : ""}`
  );
}

export function listUnitsAdmin(params: { page: number; limit: number; search?: string } & SortParams) {
  const qs = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
  if (params.search) qs.set("search", params.search);
  applySort(qs, params);
  return apiRequest<Paginated<Unit>>(`/api/v1/units?${qs.toString()}`);
}

export function createUnit(body: CreateUnitBody) {
  return apiRequest<{ success: boolean; data: Unit }>("/api/v1/units", {
    method: "POST",
    body
  });
}

export function deleteUnit(id: string) {
  return apiRequest<{ success: boolean }>(`/api/v1/units/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function updateUnitPlate(id: string, plate: string) {
  return apiRequest<{ success: boolean }>(`/api/v1/units/${encodeURIComponent(id)}/plate`, {
    method: "PATCH",
    body: { plate }
  });
}

export function assignTrackerToUnit(unitId: string, trackerUid: string) {
  return apiRequest<{ success: boolean }>(`/api/v1/units/${encodeURIComponent(unitId)}/tracker`, {
    method: "POST",
    body: { trackerUid }
  });
}

export function unassignTrackerFromUnit(unitId: string) {
  return apiRequest<{ success: boolean }>(`/api/v1/units/${encodeURIComponent(unitId)}/tracker`, {
    method: "DELETE"
  });
}

// ---------- Companies (para el formulario de vehículos) ----------

export interface Company {
  uid: string;
  name: string | null;
  country: string | null;
  status: string | null;
}

export function listCompaniesLocal(params: { page: number; limit: number; search?: string } = { page: 1, limit: 100 }) {
  const qs = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
  if (params.search) qs.set("search", params.search);
  return apiRequest<Paginated<Company>>(`/api/v1/tracking/companies/local?${qs.toString()}`);
}

export function syncCompanies() {
  return apiRequest<{ success: boolean; data: unknown }>("/api/v1/tracking/companies/sync", {
    method: "POST"
  });
}

// ---------- Mensajería: alertas para WhatsApp (solo root) ----------

export interface CriticalAlertTypeRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  matchSystemName: string | null;
  active: boolean;
  notifyWhatsapp: boolean;
}

export function listCriticalAlertTypes() {
  return apiRequest<Paginated<CriticalAlertTypeRow>>("/api/v1/tracking/critical-alerts?limit=100");
}

export function updateCriticalAlertType(id: number, body: { notifyWhatsapp?: boolean; active?: boolean }) {
  return apiRequest<{ success: boolean; data: CriticalAlertTypeRow }>(`/api/v1/tracking/critical-alerts/${id}`, {
    method: "PATCH",
    body
  });
}

// ---------- Alertas: eventos detectados ----------

export interface CriticalAlertEventRow {
  id: number;
  alertTypeCode: string;
  alertTypeName: string;
  unitUid: string;
  unitName: string | null;
  unitImei: string | null;
  companyUid: string | null;
  contactPhone: string | null;
  driverName: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  speed: number | null;
  heading: number | null;
  description: string | null;
  occurredAt: string;
  createdAt: string;
  whatsappStatus: string | null;
  whatsappSentAt: string | null;
  whatsappError: string | null;
  read: boolean;
  readAt: string | null;
}

export function listCriticalAlertEvents(params: {
  page: number;
  limit: number;
  search?: string;
  alertTypeCode?: string;
  unitUid?: string;
  read?: boolean;
} & SortParams) {
  const qs = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
  if (params.search) qs.set("search", params.search);
  if (params.alertTypeCode) qs.set("alertTypeCode", params.alertTypeCode);
  if (params.unitUid) qs.set("unitUid", params.unitUid);
  if (params.read !== undefined) qs.set("read", String(params.read));
  applySort(qs, params);
  return apiRequest<Paginated<CriticalAlertEventRow>>(`/api/v1/tracking/critical-alerts/events?${qs.toString()}`);
}

export function markCriticalAlertEventRead(id: number, read: boolean) {
  return apiRequest<{ success: boolean; data: CriticalAlertEventRow }>(
    `/api/v1/tracking/critical-alerts/events/${id}`,
    { method: "PATCH", body: { read } }
  );
}

export function resendCriticalAlertWhatsapp(id: number, phone?: string) {
  return apiRequest<{ success: boolean; data: { success: boolean; phones: string[] } }>(
    `/api/v1/tracking/critical-alerts/events/${id}/resend-whatsapp`,
    { method: "POST", body: phone ? { phone } : undefined }
  );
}

export interface WhatsappPreview {
  configured: boolean;
  phones: string[];
  message: string | null;
  unitName: string | null;
  unitUid: string | null;
  reason?: string;
}

export function previewCriticalAlertWhatsapp(id: number) {
  return apiRequest<{ success: boolean; data: WhatsappPreview }>(
    `/api/v1/tracking/critical-alerts/events/${id}/resend-whatsapp`
  );
}

export function countUnreadCriticalAlertEvents() {
  return listCriticalAlertEvents({ page: 1, limit: 1, read: false });
}

// ---------- Mensajería: plantillas de WhatsApp (solo root) ----------

export interface AlertTemplate {
  id: number;
  accountId: string | null;
  channelId: string | null;
  templateId: string | null;
  templateLabel: string | null;
  templateText: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AlertTemplateBody = {
  accountId: string | null;
  channelId: string | null;
  templateId: string | null;
  templateLabel: string | null;
  templateText: string | null;
  active: boolean;
};

export function listAlertTemplates() {
  return apiRequest<{ success: boolean; data: AlertTemplate[] }>("/api/v1/messaging/alert-templates");
}

export function createAlertTemplate(body: AlertTemplateBody) {
  return apiRequest<{ success: boolean; data: AlertTemplate }>("/api/v1/messaging/alert-templates", {
    method: "POST",
    body
  });
}

export function updateAlertTemplate(id: number, body: Partial<AlertTemplateBody>) {
  return apiRequest<{ success: boolean; data: AlertTemplate }>(`/api/v1/messaging/alert-templates/${id}`, {
    method: "PATCH",
    body
  });
}

export function deleteAlertTemplate(id: number) {
  return apiRequest<{ success: boolean }>(`/api/v1/messaging/alert-templates/${id}`, {
    method: "DELETE"
  });
}

// ---------- Dashboard ----------

export interface DashboardCounts {
  totalUnits: number;
  active: number;
  inactive: number;
  transmitting: number;
  notTransmittingOver1Day: number;
  totalCompanies: number;
}

export interface TopCompanyItem {
  companyUid: string;
  companyName: string | null;
  count: number;
}

export interface TopUnitItem {
  unitId: number;
  externalId: string;
  name: string;
  companyName: string | null;
  value: number;
}

export interface DashboardSummary {
  date: string;
  counts: DashboardCounts;
  topCompaniesByTransmitting: TopCompanyItem[];
  topUnitsByTripTime: TopUnitItem[];
  topUnitsByIdleTime: TopUnitItem[];
  topUnitsByTransmittingOff: TopUnitItem[];
  topUnitsByAlarms: TopUnitItem[];
}

export function getDashboardSummary(date: string) {
  return apiRequest<{ success: boolean; data: DashboardSummary }>(
    `/api/v1/dashboard/summary?date=${encodeURIComponent(date)}`
  );
}

// ---------- Usuarios (solo root) ----------

export interface AdminUser {
  id: number;
  username: string;
  role: string;
  whatsapp: string | null;
  active: boolean;
  createdAt: string;
  companies: { uid: string; name: string }[];
  queues: { id: number; name: string }[];
}

export interface CreateUserBody {
  username: string;
  password: string;
  role: string;
  whatsapp?: string;
  companyUids: string[];
  queueIds?: number[];
}

export interface UpdateUserBody {
  password?: string;
  role?: string;
  whatsapp?: string;
  active?: boolean;
  companyUids?: string[];
  queueIds?: number[];
}

export function listUsers() {
  return apiRequest<{ success: boolean; data: AdminUser[] }>("/api/v1/admin/users");
}

export function createUser(body: CreateUserBody) {
  return apiRequest<{ success: boolean; data: AdminUser }>("/api/v1/admin/users", {
    method: "POST",
    body
  });
}

export function updateUser(id: number, body: UpdateUserBody) {
  return apiRequest<{ success: boolean; data: AdminUser }>(`/api/v1/admin/users/${id}`, {
    method: "PATCH",
    body
  });
}

export function deleteUser(id: number) {
  return apiRequest<{ success: boolean }>(`/api/v1/admin/users/${id}`, {
    method: "DELETE"
  });
}

// ---------- Estadísticas: reporte de eventos de conductor ----------

export interface DriverEventTypeOption {
  code: string;
  name: string;
}

export function listDriverEventTypes() {
  return apiRequest<{ success: boolean; data: DriverEventTypeOption[] }>(
    "/api/v1/tracking/reports/driver-event-types"
  );
}

export interface DriverEvent {
  unitUid: string;
  unitName: string | null;
  alertTypeCode: string;
  alertTypeName: string;
  occurredAtUtc: string;
  occurredAtLocal: string | null;
  speed: number;
  speedMeasure: string | null;
  heading: number;
  ignition: string | null;
  odometer: number | null;
  latitude: number;
  longitude: number;
  address: string | null;
  driverName: string | null;
  description: string | null;
}

export interface DriverEventsReport {
  from: string;
  to: string;
  unitsRequested: string[];
  eventTypesRequested: string[];
  positionsChecked: number;
  pagesProcessed: number;
  truncated: boolean;
  events: DriverEvent[];
}

export function getDriverEventsReport(params: {
  companyUid: string;
  from: string;
  to: string;
  units: string[];
  eventTypes: string[];
}) {
  const qs = new URLSearchParams({
    companyUid: params.companyUid,
    from: params.from,
    to: params.to,
    units: params.units.join(","),
    eventTypes: params.eventTypes.join(",")
  });

  return apiRequest<{ success: boolean; data: DriverEventsReport }>(
    `/api/v1/tracking/reports/driver-events?${qs.toString()}`
  );
}

// ---------- Chat interno: tickets / colas / FAQ (Fase 1 chatbot) ----------

export interface ChatTicket {
  id: number;
  subject: string;
  description: string;
  priority: string;
  status: string;
  companyUid: string | null;
  unitUid: string | null;
  queueId: number | null;
  requesterName: string | null;
  requesterPhone: string | null;
  createdByUserId: number | null;
  createdByUsername: string | null;
  assignedToUserId: number | null;
  assignedToUsername: string | null;
  botStatus: string | null;
  botMenuQueueId: number | null;
  createdAt: string;
  updatedAt: string;
}

export function listChatTickets(params: { status?: string; queueId?: number; view?: "unclaimed" | "historico" } = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.queueId !== undefined) qs.set("queueId", String(params.queueId));
  if (params.view) qs.set("view", params.view);
  const query = qs.toString();
  return apiRequest<{ success: boolean; data: ChatTicket[] }>(`/api/v1/tickets${query ? `?${query}` : ""}`);
}

export function getChatTicket(id: number) {
  return apiRequest<{ success: boolean; data: ChatTicket }>(`/api/v1/tickets/${id}`);
}

export interface CreateChatTicketBody {
  subject: string;
  description: string;
  priority?: string;
  companyUid?: string;
  queueId?: number;
  requesterName?: string;
  requesterPhone?: string;
}

export function createChatTicket(body: CreateChatTicketBody) {
  return apiRequest<{ success: boolean; data: ChatTicket }>("/api/v1/tickets", { method: "POST", body });
}

export interface UpdateChatTicketBody {
  status?: string;
  priority?: string;
  queueId?: number | null;
  assignedToUserId?: number | null;
  claim?: boolean;
  release?: boolean;
}

export function updateChatTicket(id: number, body: UpdateChatTicketBody) {
  return apiRequest<{ success: boolean; data: ChatTicket }>(`/api/v1/tickets/${id}`, { method: "PATCH", body });
}

export type ChatQueueKind = "principal" | "secundaria";
export type ChatQueueDestination = "cola" | "agentes";

export interface ChatQueue {
  id: number;
  name: string;
  description: string | null;
  kind: ChatQueueKind;
  destination: ChatQueueDestination;
  parentId: number | null;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatQueueBody {
  name?: string;
  description?: string | null;
  kind?: ChatQueueKind;
  destination?: ChatQueueDestination;
  parentId?: number | null;
  sortOrder?: number;
  active?: boolean;
}

export function listChatQueues() {
  return apiRequest<{ success: boolean; data: ChatQueue[] }>("/api/v1/chat-queues");
}

export function createChatQueue(body: ChatQueueBody) {
  return apiRequest<{ success: boolean; data: ChatQueue }>("/api/v1/chat-queues", {
    method: "POST",
    body
  });
}

export function updateChatQueue(id: number, body: ChatQueueBody) {
  return apiRequest<{ success: boolean; data: ChatQueue }>(`/api/v1/chat-queues/${id}`, {
    method: "PATCH",
    body
  });
}

export interface ChatBotConfig {
  greeting: string;
  invalidOption: string;
  transferMessage: string;
}

export function getChatBotConfig() {
  return apiRequest<{ success: boolean; data: ChatBotConfig | null }>("/api/v1/chat-bot/config");
}

export function saveChatBotConfig(body: ChatBotConfig) {
  return apiRequest<{ success: boolean; data: ChatBotConfig }>("/api/v1/chat-bot/config", {
    method: "PUT",
    body
  });
}

export interface ChatAttachmentInfo {
  id: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ChatMessage {
  id: number;
  ticketId: number;
  senderType: "cliente" | "bot" | "agente";
  senderUserId: number | null;
  senderUsername: string | null;
  body: string;
  createdAt: string;
  attachments: ChatAttachmentInfo[];
}

/**
 * Descarga un adjunto del chat (ej. reporte PDF del bot). No usa
 * apiRequest porque la respuesta es binaria, no JSON; el token va en
 * el header igual que en el resto de las llamadas.
 */
export async function downloadChatAttachment(ticketId: number, attachment: ChatAttachmentInfo): Promise<void> {
  const token = getStoredToken();

  const response = await fetch(`${API_BASE_URL}/api/v1/tickets/${ticketId}/attachments/${attachment.id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });

  if (!response.ok) {
    throw new ApiError(response.status, "No se pudo descargar el archivo");
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function listChatMessages(ticketId: number) {
  return apiRequest<{ success: boolean; data: ChatMessage[] }>(`/api/v1/tickets/${ticketId}/messages`);
}

export function sendChatMessage(ticketId: number, body: string) {
  return apiRequest<{ success: boolean; data: { ticket: ChatTicket; messages: ChatMessage[] } }>(
    `/api/v1/tickets/${ticketId}/messages`,
    { method: "POST", body: { body } }
  );
}

export interface QueueAgent {
  id: number;
  username: string;
}

export function listQueueAgents(queueId: number) {
  return apiRequest<{ success: boolean; data: QueueAgent[] }>(`/api/v1/chat-queues/${queueId}/agents`);
}

// ---------- Notificaciones internas (campana) ----------

export interface ChatNotification {
  id: number;
  userId: number;
  ticketId: number | null;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export function listNotifications() {
  return apiRequest<{ success: boolean; data: { items: ChatNotification[]; unread: number } }>("/api/v1/notifications");
}

export function markNotificationRead(id: number) {
  return apiRequest<{ success: boolean }>(`/api/v1/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead() {
  return apiRequest<{ success: boolean }>("/api/v1/notifications/read-all", { method: "POST" });
}

export interface ChatFaq {
  id: number;
  question: string;
  answer: string;
  category: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export function listChatFaq(params: { active?: boolean; category?: string; search?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.active !== undefined) qs.set("active", String(params.active));
  if (params.category) qs.set("category", params.category);
  if (params.search) qs.set("search", params.search);
  const query = qs.toString();
  return apiRequest<{ success: boolean; data: ChatFaq[] }>(`/api/v1/faq${query ? `?${query}` : ""}`);
}

export interface CreateChatFaqBody {
  question: string;
  answer: string;
  category?: string;
  active?: boolean;
}

export function createChatFaq(body: CreateChatFaqBody) {
  return apiRequest<{ success: boolean; data: ChatFaq }>("/api/v1/faq", { method: "POST", body });
}

