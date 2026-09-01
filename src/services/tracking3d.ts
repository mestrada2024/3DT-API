export interface Tracking3DSession {
  userIdGuid: string;
  sessionId: string;
}

export class Tracking3DService {

  private readonly baseUrl: string;
  private readonly userIdGuid: string;
  private readonly password: string;

  constructor() {
    this.baseUrl = process.env.TRACKING3D_BASE_URL || "";
    this.userIdGuid = process.env.TRACKING3D_USER_ID_GUID || "";
    this.password = process.env.TRACKING3D_PASSWORD || "";

    if (!this.baseUrl) {
      throw new Error("TRACKING3D_BASE_URL is required");
    }

    if (!this.userIdGuid) {
      throw new Error("TRACKING3D_USER_ID_GUID is required");
    }

    if (!this.password) {
      throw new Error("TRACKING3D_PASSWORD is required");
    }
  }

  async authenticate(): Promise<Tracking3DSession> {

  const url = `${this.baseUrl}/Authentication/UserAuthenticate`;

  const params = new URLSearchParams({
    UserName: this.userIdGuid,
    Password: this.password
  });

  const response = await fetch(`${url}?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `3Dtracking authentication failed: HTTP ${response.status} - ${responseText}`
    );
  }

  let data: any;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Invalid JSON response from 3Dtracking: ${responseText}`
    );
  }

  if (!data) {
    throw new Error("Empty response from 3Dtracking");
  }

  return {
    userIdGuid: this.userIdGuid,
    sessionId: data.SessionId
  };
}

  async authenticate_22(): Promise<Tracking3DSession> {

    const url = `${this.baseUrl}/Authentication/UserAuthenticate`;

    const params = new URLSearchParams({
      UserIdGuid: this.userIdGuid,
      Password: this.password
    });

    const response = await fetch(`${url}?${params.toString()}`, {
      method: "GET"
    });

    if (!response.ok) {
      throw new Error(
        `3Dtracking authentication failed: HTTP ${response.status}`
      );
    }

    const data = await response.json();

    if (!data) {
      throw new Error("Empty response from 3Dtracking");
    }

    return {
      userIdGuid: this.userIdGuid,
      sessionId: data.SessionId
    };
  }
}
