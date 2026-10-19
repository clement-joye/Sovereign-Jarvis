export interface MatrixMediaClientOptions {
  homeserverUrl: string;
  accessToken: string;
  maxDownloadBytes: number;
  fetchFn?: typeof fetch;
}

export class MatrixMediaClient {
  private readonly homeserverUrl: string;
  private readonly accessToken: string;
  private readonly maxDownloadBytes: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: MatrixMediaClientOptions) {
    this.homeserverUrl = options.homeserverUrl.replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.maxDownloadBytes = options.maxDownloadBytes;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async download(contentUri: string): Promise<{ bytes: Uint8Array; mediaType: string }> {
    const { serverName, mediaId } = parseMxcUri(contentUri);
    let response = await this.fetchFn(
      `${this.homeserverUrl}/_matrix/client/v1/media/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
      { headers: { authorization: `Bearer ${this.accessToken}` } }
    );
    // Matrix 1.11 introduced authenticated media download endpoints. The
    // legacy endpoint is retained for older homeservers, which report an
    // unrecognized route using 404 M_UNRECOGNIZED.
    if (response.status === 404 && (await isUnrecognizedEndpoint(response))) {
      response = await this.fetchFn(
        `${this.homeserverUrl}/_matrix/media/v3/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
        { headers: { authorization: `Bearer ${this.accessToken}` } }
      );
    }
    if (!response.ok) {
      throw new Error(`Matrix media download failed: ${response.status}`);
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > this.maxDownloadBytes) {
      throw new Error("Matrix media exceeds the configured download limit.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.maxDownloadBytes) {
      throw new Error("Matrix media exceeds the configured download limit.");
    }
    return {
      bytes,
      mediaType:
        response.headers.get("content-type")?.split(";", 1)[0] ?? "application/octet-stream"
    };
  }

  async upload(input: {
    bytes: Uint8Array;
    mediaType: string;
    filename: string;
  }): Promise<{ contentUri: string }> {
    const response = await this.fetchFn(
      `${this.homeserverUrl}/_matrix/media/v3/upload?filename=${encodeURIComponent(input.filename)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          "content-type": input.mediaType
        },
        body: input.bytes
      }
    );
    if (!response.ok) {
      throw new Error(`Matrix media upload failed: ${response.status}`);
    }
    const body = (await response.json()) as { content_uri?: unknown };
    if (typeof body.content_uri !== "string" || !body.content_uri.startsWith("mxc://")) {
      throw new Error("Matrix media upload did not return an MXC content URI.");
    }
    return { contentUri: body.content_uri };
  }
}

async function isUnrecognizedEndpoint(response: Response): Promise<boolean> {
  try {
    const body: unknown = await response.json();
    return isRecord(body) && body.errcode === "M_UNRECOGNIZED";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseMxcUri(contentUri: string): { serverName: string; mediaId: string } {
  const match = /^mxc:\/\/([^/]+)\/(.+)$/.exec(contentUri);
  if (!match?.[1] || !match[2]) {
    throw new Error("Matrix media content URI must use the mxc:// scheme.");
  }
  return { serverName: match[1], mediaId: match[2] };
}
