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
