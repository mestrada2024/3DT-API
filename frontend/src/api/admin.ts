import { apiRequest } from "./client";

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
}) {
  const qs = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
  if (params.search) qs.set("search", params.search);
  if (params.alertTypeCode) qs.set("alertTypeCode", params.alertTypeCode);
  if (params.unitUid) qs.set("unitUid", params.unitUid);
  if (params.read !== undefined) qs.set("read", String(params.read));
  return apiRequest<Paginated<CriticalAlertEventRow>>(`/api/v1/tracking/critical-alerts/events?${qs.toString()}`);
}

export function markCriticalAlertEventRead(id: number, read: boolean) {
  return apiRequest<{ success: boolean; data: CriticalAlertEventRow }>(
    `/api/v1/tracking/critical-alerts/events/${id}`,
    { method: "PATCH", body: { read } }
  );
}

export function resendCriticalAlertWhatsapp(id: number) {
  return apiRequest<{ success: boolean; data: { success: boolean; phones: string[] } }>(
    `/api/v1/tracking/critical-alerts/events/${id}/resend-whatsapp`,
    { method: "POST" }
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
  active: boolean;
  createdAt: string;
  companies: { uid: string; name: string }[];
}

export interface CreateUserBody {
  username: string;
  password: string;
  role: string;
  companyUids: string[];
}

export interface UpdateUserBody {
  password?: string;
  role?: string;
  active?: boolean;
  companyUids?: string[];
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
