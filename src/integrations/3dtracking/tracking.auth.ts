export interface Tracking3DSession {
  userIdGuid: string;
  sessionId: string;
}

export class Tracking3DAuth {

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

    const url =
      `${this.baseUrl}/Authentication/UserAuthenticate`;

    const params = new URLSearchParams({
      UserName: this.userIdGuid,
      Password: this.password
    });

    const requestUrl = `${url}?${params.toString()}`;

    const response = await fetch(requestUrl, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    const responseText = await response.text();

    console.log("========== 3DTRACKING AUTH ==========");
    console.log("HTTP:", response.status);
    console.log("Response:", responseText);
    console.log("======================================");

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

    console.log("3Dtracking parsed response:", data);

	const sessionId =
	  data?.Result?.SessionId ??
	  data?.Result?.sessionId ??
	  data?.Result?.SessionID ??
	  data?.Result?.sessionID;

	if (!sessionId) {
	  throw new Error(
		`3Dtracking did not return SessionId. Response: ${responseText}`
	  );
	}

	return {
	  userIdGuid: data.Result.UserIdGuid || this.userIdGuid,
	  sessionId: String(sessionId)
	};
  }
}