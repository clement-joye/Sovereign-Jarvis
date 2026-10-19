import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createInferenceGateway } from "./index.js";

const servers: ReturnType<typeof createInferenceGateway>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
    )
  );
  servers.length = 0;
});

describe("inference gateway", () => {
  it("replaces caller authorization and proxies chat completions", async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"choices":[]}', {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "request-one" }
      })
    );
    const server = createInferenceGateway({
      upstreamBaseUrl: "http://model.test:8080/v1/",
      apiKey: "protected-key",
      fetch: upstreamFetch
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer caller-controlled-value",
        "content-type": "application/json"
      },
      body: '{"model":"local"}'
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("request-one");
    expect(upstreamFetch).toHaveBeenCalledOnce();
    const [url, init] = upstreamFetch.mock.calls[0] ?? [];
    expect(url).toBe("http://model.test:8080/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer protected-key");
    expect(init?.body).toEqual(Buffer.from('{"model":"local"}'));
  });

  it("exposes only health and chat completions", async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    const server = createInferenceGateway({
      upstreamBaseUrl: "http://model.test:8080/v1",
      apiKey: "protected-key",
      fetch: upstreamFetch
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/v1/models`)).status).toBe(404);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("omits authorization for a credential-free upstream", async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    const server = createInferenceGateway({
      upstreamBaseUrl: "http://model.test:8080/v1",
      fetch: upstreamFetch
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    expect(
      (
        await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
          method: "POST",
          body: "{}"
        })
      ).status
    ).toBe(200);
    const [, init] = upstreamFetch.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  });
});
