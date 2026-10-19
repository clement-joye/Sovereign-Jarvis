import { createServer } from "node:http";

const token = process.env.RUNTIME_PROVISIONER_TOKEN;
if (!token) throw new Error("RUNTIME_PROVISIONER_TOKEN is required.");

const provisioned = new Set();

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return write(response, 200, { service: "workspace-runtime-stub", status: "live" });
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    return write(response, 401, { error: "unauthorized" });
  }

  const provision = request.method === "POST" && request.url === "/v1/runtimes/provision";
  if (provision) {
    const body = await readJson(request);
    if (typeof body.workspaceId !== "string" || body.workspaceId.length === 0) {
      return write(response, 400, { error: "invalid_provision_request" });
    }
    provisioned.add(body.workspaceId);
    return write(response, 201, { runtimeId: `system-test-runtime-${body.workspaceId}` });
  }

  const health = request.url?.match(/^\/v1\/runtimes\/([A-Za-z0-9_-]+)\/health$/);
  if (request.method === "GET" && health) {
    return write(response, 200, { health: provisioned.has(health[1]) ? "ready" : "unprovisioned" });
  }

  const archive = request.url?.match(/^\/v1\/runtimes\/([A-Za-z0-9_-]+)\/archive$/);
  if (request.method === "POST" && archive) {
    provisioned.delete(archive[1]);
    return write(response, 200, { ok: true });
  }

  const cancellation = request.url?.match(
    /^\/v1\/runtimes\/([A-Za-z0-9_-]+)\/pi-runs\/([A-Za-z0-9_-]+)\/cancel$/
  );
  if (request.method === "POST" && cancellation) {
    return write(response, 202, { cancelled: true, runId: cancellation[2] });
  }
  return write(response, 404, { error: "not_found" });
}).listen(3040, () => console.info("workspace runtime stub started"));

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function write(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
