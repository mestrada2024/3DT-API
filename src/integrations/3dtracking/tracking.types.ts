export interface Tracking3DSession {
  userIdGuid: string;
  sessionId: string;
}

export interface Tracking3DUnit {
  trackingId: number;
  imei?: string;
  name?: string;
  plate?: string;
  latitude?: number;
  longitude?: number;
  speed?: number;
  heading?: number;
  mileage?: number;
  recordedAt?: string;
  active?: boolean;
}

export interface Tracking3DPosition {
  trackingId: number;
  imei?: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  mileage?: number;
  recordedAt?: string;
}

export interface Tracking3DResponse<T> {
  success: boolean;
  data: T;
}

export interface Tracking3DUnitListItem {
  Uid: string;
  Name: string;
  IMEI: string;
  Status: string;
  GroupName: string;
  CompanyName: string;
  CompanyUid: string;
  PhoneNumber: string;
  UnitType: string;
  CreatedDateTimeUtc: string;
}

export interface Tracking3DAttribute {
  AttributeId: number;
  Name: string;
  Group: string;
  DataType: string;
  Value: string | null;
  LastUpdatedBy: string;
  LastUpdatedDate: string;
}

export interface Tracking3DUnitDetail {
  Uid: string;
  Name: string;
  IMEI: string;
  Status: string;
  GroupName: string;
  CompanyName: string;
  CompanyUid: string;
  PhoneNumber: string;
  UnitType: string;
  Information: string;
  CreatedDateTimeUtc: string;
  DriverUid: string;
  AdditionalDetails: {
    Attributes: Tracking3DAttribute[];
  };
  PartnerCustomInfo: {
    Attributes: Tracking3DAttribute[];
  };
}

export interface Tracking3DSimCard {
  Uid: string;
  PhoneNumber: string;
  PIN: string;
  PUK: string;
  ICCID: string;
  TrackerUid: string;
  CreatedDateTimeUtc: string;
}

export interface Tracking3DCreateSimPayload {
  ICCID: string;
  PhoneNumber?: string;
  PIN?: string;
  PUK?: string;
}

export interface Tracking3DTracker {
  Uid: string;
  Name: string;
  IMEI: string;
  TrackerTypeUid: string;
  TrackerTypeName: string;
  UnitModelUid: string;
  UnitModelName: string;
  SimUid: string;
  ActivationCode: string | null;
  CreatedDateTimeUtc: string;
}

export interface Tracking3DTrackerAssignment {
  UnitUid: string | null;
  UnitName: string | null;
  SimUid: string | null;
  PhoneNumber: string | null;
  StartTimeLocal: string | null;
  StartUser: string | null;
  EndTimeLocal: string | null;
  EndUser: string | null;
}

export interface Tracking3DTrackerAttribute {
  AttributeId: number;
  AttributeTypeId: number;
  Name: string | null;
  Group: string | null;
  DataType: string | null;
  Value: string | null;
  LastUpdatedBy: string | null;
  LastUpdatedDate: string;
  RecurringDatePart: string | null;
  RecurringNumber: number;
}

export interface Tracking3DTrackerDetail extends Tracking3DTracker {
  UnitAssignments: Tracking3DTrackerAssignment[];
  SimAssignments: Tracking3DTrackerAssignment[];
  Attributes: Tracking3DTrackerAttribute[];
}

export interface Tracking3DCreateTrackerPayload {
  Name?: string;
  IMEI: string;
  TrackerTypeUid?: string;
  UnitModelUid?: string;
  SimUid?: string;
}

export interface Tracking3DUpdateTrackerPayload {
  Name?: string;
  IMEI?: string;
  SimUid?: string;
}

export interface Tracking3DCompany {
  Uid: string;
  Name: string;
  Status: string | null;
  ServiceType: string | null;
  Country: string | null;
  Currency: string | null;
  Language: string | null;
  TimeZone: string | null;
  ContactEmail: string | null;
  ContactPhone: string | null;
  ContactPosition: string | null;
  ContactName: string | null;
  Notes: string | null;
  CreatedDateTimeUtc: string | null;
}

export interface Tracking3DCreateUnitPayload {
  Name: string;
  GroupName?: string;
  UnitFunction?: "Personal" | "AssetItem" | "Vehicle" | string;
  TrackerUid?: string;
}
