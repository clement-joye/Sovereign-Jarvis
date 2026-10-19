const url =
  process.env.MATRIX_HOMESERVER_READINESS_URL ??
  "http://matrix-homeserver:8008/_matrix/client/versions";
const timeoutMs = Number(process.env.MATRIX_HOMESERVER_READINESS_TIMEOUT_MS ?? "120000");
const pollMs = Number(process.env.MATRIX_HOMESERVER_READINESS_POLL_MS ?? "1000");
const deadline = Date.now() + timeoutMs;

while (Date.now() < deadline) {
  try {
    const response = await fetch(url);
    if (response.ok) process.exit(0);
  } catch {
    // The homeserver is still starting; retry until the bounded deadline.
  }
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}

console.error(`Matrix homeserver did not become ready within ${timeoutMs}ms: ${url}`);
process.exit(1);
