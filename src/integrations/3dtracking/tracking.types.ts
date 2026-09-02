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
