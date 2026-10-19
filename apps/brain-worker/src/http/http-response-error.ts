export class HttpResponseError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly statusCode: number,
    readonly responseBody: string
  ) {
    super(`${method} ${path} failed with ${statusCode}: ${responseBody}`);
    this.name = "HttpResponseError";
  }
}
