/** Resolves the Matrix-standard `m.tz` profile field into a valid IANA timezone. */
export class MatrixProfileTimezoneClient {
  private readonly homeserverUrl: string;
  private readonly accessToken: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: { homeserverUrl: string; accessToken: string; fetchFn?: typeof fetch }) {
    this.homeserverUrl = options.homeserverUrl.replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async get(userId: string): Promise<string | undefined> {
    try {
      const response = await this.fetchFn(
        `${this.homeserverUrl}/_matrix/client/v3/profile/${encodeURIComponent(userId)}/m.tz`,
        { headers: { authorization: `Bearer ${this.accessToken}` } }
      );
      if (!response.ok) return undefined;
      const body = (await response.json()) as { "m.tz"?: unknown };
      return isIanaTimezone(body["m.tz"]) ? body["m.tz"] : undefined;
    } catch {
      return undefined;
    }
  }
}

function isIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
