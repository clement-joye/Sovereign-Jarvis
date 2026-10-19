import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  parseFirstUserRegistrationToken,
  queryBrainFingerprints,
  runGuidedInstall
} from "./guided-install.mjs";

async function preparedState(stages, values = {}) {
  const root = await mkdtemp(join(tmpdir(), "jarvis-guide-"));
  await writeFile(
    join(root, "setup-state.json"),
    `${JSON.stringify({ version: 1, completedStages: stages })}\n`,
    { mode: 0o600 }
  );
  await writeFile(
    join(root, "production.env"),
    Object.entries({ MATRIX_SERVER_NAME: "matrix.example.test", ...values })
      .map(([key, value]) => `${key}='${value}'`)
      .join("\n") + "\n",
    { mode: 0o600 }
  );
  return root;
}

function terminal() {
  let printed = "";
  return {
    io: {
      input: { isTTY: true },
      output: { isTTY: true, write: (value) => (printed += value) }
    },
    printed: () => printed
  };
}

function interactiveTerminal(prompt, answer) {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  output.isTTY = true;
  output.columns = 80;
  let printed = "";
  const answers = Array.isArray(prompt) ? prompt : [[prompt, answer]];
  let answered = 0;
  output.on("data", (chunk) => {
    const text = chunk.toString();
    printed += text;
    if (answered < answers.length && text.includes(answers[answered][0])) {
      const response = answers[answered][1];
      answered += 1;
      queueMicrotask(() => input.write(`${response}\n`));
    }
  });
  return { io: { input, output }, printed: () => printed };
}

const noActions = {
  publishArtifacts: () => assert.fail("artifact publication must not run"),
  migrate: () => assert.fail("migration must not run"),
  start: () => assert.fail("startup must not run"),
  readHiddenSecret: () => assert.fail("secret entry must not run")
};

test("a prepared guided install pauses at private HTTPS without registering an account", async () => {
  const root = await preparedState(["environment", "artifacts"]);
  const { io, printed } = interactiveTerminal("Press Enter when HTTPS is ready", "q");
  const calls = [];
  const code = await runGuidedInstall(root, io, noActions, {
    run: (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    },
    fetch: async () => {
      throw new Error("private HTTPS is not configured");
    }
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(-2), ["up", "--detach"]);
  assert.match(printed(), /Tailscale Serve/u);
  assert.match(printed(), /Run `pnpm jarvis:setup` to resume/u);
  assert.equal(
    (await readFile(join(root, "production.env"), "utf8")).includes("MATRIX_OWNER_ID"),
    false
  );
});

test("a completed install reports the first room action without repeating stages", async () => {
  const root = await preparedState(
    ["environment", "artifacts", "matrix-bootstrap", "migration", "startup-health"],
    { MATRIX_OWNER_ID: "@owner:matrix.example.test" }
  );
  const { io, printed } = terminal();
  assert.equal(await runGuidedInstall(root, io, noActions), 0);
  assert.match(printed(), /private room/u);
  assert.match(printed(), /first encrypted reply/u);
});

test("owner recovery pause explains where Element X creates the key", async () => {
  const root = await preparedState(["environment", "artifacts"], {
    MATRIX_OWNER_ID: "@owner:matrix.example.test"
  });
  const { io, printed } = interactiveTerminal("Have you saved the owner recovery key", "n");
  assert.equal(
    await runGuidedInstall(root, io, noActions, {
      run: () => ({ status: 0 }),
      fetch: async () => ({ ok: true })
    }),
    0
  );
  assert.match(printed(), /Owner account @owner:matrix\.example\.test is registered/u);
  assert.match(printed(), /registration token is not needed for sign-in/u);
  assert.match(printed(), /profile avatar > Encryption > Get recovery key/u);
  assert.match(printed(), /separate from the brain recovery key/u);
  assert.match(printed(), /Finish owner recovery setup in Element/u);
});

test("extracts only an unambiguous first-user token from homeserver logs", () => {
  const startup =
    "In order to use your new homeserver, you need to create its\n" +
    "first user account.\nOpen your Matrix client of choice and register an account\n" +
    "on \u001b[1;32mmatrix.example.test\u001b[0m using the registration token first-user-secret . Pick your own username and password!\n";
  assert.equal(
    parseFirstUserRegistrationToken(startup, "matrix.example.test"),
    "first-user-secret"
  );
  assert.equal(
    parseFirstUserRegistrationToken(
      `${startup}first user account. on matrix.example.test using registration token another-secret .`,
      "matrix.example.test"
    ),
    undefined
  );
  assert.equal(parseFirstUserRegistrationToken(startup, "another.example.test"), undefined);
  assert.equal(
    parseFirstUserRegistrationToken("registration token unrelated-secret", "matrix.example.test"),
    undefined
  );
});

test("guided owner registration reads and displays the first-user token without prompting for it", async () => {
  const root = await preparedState(["environment", "artifacts"], { MATRIX_OWNER_ID: "" });
  const { io, printed } = interactiveTerminal([
    ["Owner username (localpart only)", "owner"],
    ["Have you saved the owner recovery key", "n"]
  ]);
  const secrets = [];
  assert.equal(
    await runGuidedInstall(
      root,
      io,
      {
        ...noActions,
        readHiddenSecret: async (_input, _output, label) => {
          secrets.push(label);
          return "owner-password";
        }
      },
      {
        run: (_command, args) =>
          args.includes("logs")
            ? {
                status: 0,
                stdout:
                  "first user account. Register on \u001b[1;32mmatrix.example.test\u001b[0m using the registration token first-user-secret ."
              }
            : { status: 0 },
        fetch: async (url, options) => {
          const path = String(url);
          if (path.endsWith("/_matrix/client/versions")) return { ok: true };
          if (path.includes("/_matrix/client/v3/profile/")) return { ok: true };
          if (path.endsWith("/_continuwuity/local_user_count")) {
            assert.fail("Fresh registration must not request the protected user count.");
          }
          if (path.endsWith("/_matrix/client/v3/register")) {
            if (options.body.includes('"auth"')) {
              assert.equal(JSON.parse(options.body).auth.token, "first-user-secret");
              return { ok: true, json: async () => ({ user_id: "@owner:matrix.example.test" }) };
            }
            return {
              status: 401,
              json: async () => ({
                session: "first-user-session",
                flows: [{ stages: ["m.login.registration_token"] }]
              })
            };
          }
          assert.fail(`Unexpected Matrix request: ${path}`);
        }
      }
    ),
    0
  );
  assert.deepEqual(secrets, ["Owner Matrix password", "Confirm owner matrix password"]);
  assert.match(printed(), /first-user token from homeserver logs: first-user-secret/u);
  assert.doesNotMatch(await readFile(join(root, "production.env"), "utf8"), /first-user-secret/u);
});

test("guided setup verifies a pending owner account instead of repeating registration", async () => {
  const root = await preparedState(["environment", "artifacts"], { MATRIX_OWNER_ID: "" });
  await writeFile(join(root, "production.env.owner-registration-pending"), "pending\n", {
    mode: 0o600
  });
  const { io, printed } = interactiveTerminal([
    ["Owner username used in the previous attempt", "cj"],
    ["Have you saved the owner recovery key", "n"]
  ]);
  const requests = [];
  assert.equal(
    await runGuidedInstall(
      root,
      io,
      {
        ...noActions,
        readHiddenSecret: async () => "owner-password"
      },
      {
        run: () => ({ status: 0 }),
        fetch: async (url, options) => {
          const path = String(url);
          requests.push(path);
          if (path.endsWith("/_matrix/client/versions")) return { ok: true };
          if (path.includes("/_matrix/client/v3/profile/")) return { ok: true };
          if (path.endsWith("/_matrix/client/v3/login")) {
            assert.equal(JSON.parse(options.body).identifier.user, "cj");
            return {
              ok: true,
              json: async () => ({
                user_id: "@cj:matrix.example.test",
                access_token: "temporary-token"
              })
            };
          }
          if (path.endsWith("/_matrix/client/v3/logout")) return { ok: true };
          assert.fail(`Unexpected Matrix request: ${path}`);
        }
      }
    ),
    0
  );
  assert.doesNotMatch(requests.join("\n"), /\/register/u);
  assert.match(printed(), /verified and recorded/u);
  assert.match(
    await readFile(join(root, "production.env"), "utf8"),
    /MATRIX_OWNER_ID='@cj:matrix\.example\.test'/u
  );
});

test("a prefilled owner ID on an empty homeserver resumes registration", async () => {
  const root = await preparedState(["environment", "artifacts"], {
    MATRIX_OWNER_ID: "@owner:matrix.example.test"
  });
  const { io, printed } = interactiveTerminal([
    ["Owner username (localpart only)", "owner"],
    ["Have you saved the owner recovery key", "n"]
  ]);
  let registered = false;
  assert.equal(
    await runGuidedInstall(
      root,
      io,
      {
        ...noActions,
        readHiddenSecret: async (_input, _output, label) =>
          label.includes("token") ? "first-user-token" : "owner-password"
      },
      {
        run: () => ({ status: 0 }),
        fetch: async (url, options) => {
          const path = String(url);
          if (path.endsWith("/_matrix/client/versions")) return { ok: true };
          if (path.includes("/_matrix/client/v3/profile/")) return { ok: registered };
          if (path.endsWith("/_continuwuity/local_user_count")) {
            return { ok: true, json: async () => ({ count: 0 }) };
          }
          if (path.endsWith("/_matrix/client/v3/register")) {
            if (options.body.includes('"auth"')) {
              registered = true;
              return { ok: true, json: async () => ({ user_id: "@owner:matrix.example.test" }) };
            }
            return {
              status: 401,
              json: async () => ({
                session: "first-user-session",
                flows: [{ stages: ["m.login.registration_token"] }]
              })
            };
          }
          assert.fail(`Unexpected Matrix request: ${path}`);
        }
      }
    ),
    0
  );
  assert.match(printed(), /Cleared the stale ID/u);
  assert.match(printed(), /Jarvis will create the first owner account now/u);
  assert.match(printed(), /logs matrix-homeserver/u);
  assert.match(printed(), /Owner account registered/u);
  assert.match(
    await readFile(join(root, "production.env"), "utf8"),
    /MATRIX_OWNER_ID='@owner:matrix\.example\.test'/u
  );
});

test("a prefilled owner ID with other homeserver users stops for reconciliation", async () => {
  const root = await preparedState(["environment", "artifacts"], {
    MATRIX_OWNER_ID: "@owner:matrix.example.test"
  });
  const { io, printed } = terminal();
  await assert.rejects(
    runGuidedInstall(root, io, noActions, {
      run: () => ({ status: 0 }),
      fetch: async (url) => {
        const path = String(url);
        if (path.endsWith("/_matrix/client/versions")) return { ok: true };
        if (path.endsWith("/_continuwuity/local_user_count")) {
          return { ok: true, json: async () => ({ count: 1 }) };
        }
        return { ok: false };
      }
    }),
    /other users exist/u
  );
  assert.doesNotMatch(printed(), /Have you saved the owner recovery key/u);
});

test("a prefilled owner ID remains intact when the homeserver forbids the user count", async () => {
  const root = await preparedState(["environment", "artifacts"], {
    MATRIX_OWNER_ID: "@owner:matrix.example.test"
  });
  const { io, printed } = terminal();
  await assert.rejects(
    runGuidedInstall(root, io, noActions, {
      run: () => ({ status: 0 }),
      fetch: async (url) => {
        const path = String(url);
        if (path.endsWith("/_matrix/client/versions")) return { ok: true };
        if (path.endsWith("/_continuwuity/local_user_count")) {
          return { ok: false, status: 403 };
        }
        if (path.includes("/_matrix/client/v3/profile/")) return { ok: false };
        assert.fail(`Unexpected Matrix request: ${path}`);
      }
    }),
    /will not clear the owner ID without proof that no users exist/u
  );
  assert.match(
    await readFile(join(root, "production.env"), "utf8"),
    /MATRIX_OWNER_ID='@owner:matrix\.example\.test'/u
  );
  assert.doesNotMatch(printed(), /Owner username/u);
});

test("guided installation needs a terminal before performing a stage", async () => {
  const root = await preparedState(["environment"]);
  const { io, printed } = terminal();
  io.input.isTTY = false;
  assert.equal(await runGuidedInstall(root, io, noActions), 2);
  assert.match(printed(), /requires a terminal/u);
});

test("brain fingerprint review retrieves public keys without exposing the access token", async () => {
  let request;
  const keys = await queryBrainFingerprints(
    "https://matrix.example.test",
    "@brain:matrix.example.test",
    "private-access-token",
    async (url, options) => {
      request = { url: String(url), options };
      return {
        ok: true,
        json: async () => ({
          master_keys: {
            "@brain:matrix.example.test": { keys: { "ed25519:master": "public-master" } }
          },
          device_keys: {
            "@brain:matrix.example.test": {
              DEVICE: { keys: { "ed25519:DEVICE": "public-device" } }
            }
          }
        })
      };
    }
  );
  assert.deepEqual(keys, {
    master: "public-master",
    devices: [{ id: "DEVICE", key: "public-device" }]
  });
  assert.equal(request.options.headers.authorization, "Bearer private-access-token");
  assert.equal(request.url, "https://matrix.example.test/_matrix/client/v3/keys/query");
});
