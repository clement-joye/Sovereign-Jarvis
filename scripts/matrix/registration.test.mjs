import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  MatrixRegistrationReconciliationError,
  reconcileOwnerRegistration,
  registerBrain,
  registerOwner
} from "./registration.mjs";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-matrix-register-"));
  const envFile = join(directory, "production.env");
  await writeFile(
    envFile,
    "MATRIX_OWNER_ID=''\nMATRIX_BRAIN_USER_ID=''\nMATRIX_ACCESS_TOKEN=''\nCONTINUWUITY_REGISTRATION_TOKEN='brain-secret'\n",
    { mode: 0o600 }
  );
  return envFile;
}

function fakeRegistration({
  userId,
  failFinal = false,
  finalResponse,
  omitAccessToken = false,
  logoutFails = false
}) {
  const requests = [];
  const fetchImplementation = async (url, options) => {
    requests.push({
      url: String(url),
      body: options?.body && JSON.parse(options.body),
      authorization: options?.headers?.authorization
    });
    if (String(url).endsWith("/_continuwuity/local_user_count")) {
      assert.fail("Owner registration must not depend on the protected user-count endpoint.");
    }
    if (String(url).endsWith("/_matrix/client/v3/logout")) {
      return { ok: !logoutFails, status: logoutFails ? 500 : 200 };
    }
    if (!options?.body || !JSON.parse(options.body).auth) {
      return {
        status: 401,
        json: async () => ({
          session: "registration-session",
          flows: [{ stages: ["m.login.registration_token"] }]
        })
      };
    }
    if (failFinal) throw new Error("Connection ended after request was sent");
    if (finalResponse) return finalResponse;
    return {
      ok: true,
      json: async () => ({
        user_id: userId,
        ...(omitAccessToken ? {} : { access_token: "access-secret" })
      })
    };
  };
  return { requests, fetchImplementation };
}

test("owner registration uses the first-user challenge and persists only its Matrix ID", async () => {
  const envFile = await fixture();
  const fake = fakeRegistration({ userId: "@owner:matrix.example.test", omitAccessToken: true });
  const result = await registerOwner({
    homeserverUrl: "https://matrix.example.test",
    serverName: "matrix.example.test",
    username: "owner",
    password: "owner-password",
    registrationToken: "first-user-secret",
    envFile,
    fetchImplementation: fake.fetchImplementation
  });
  assert.deepEqual(result, { userId: "@owner:matrix.example.test" });
  assert.equal(fake.requests[0].body.inhibit_login, true);
  assert.equal(fake.requests[1].body.inhibit_login, true);
  assert.equal(fake.requests[1].body.auth.token, "first-user-secret");
  assert.equal(fake.requests.length, 2);
  const content = await readFile(envFile, "utf8");
  assert.match(content, /MATRIX_OWNER_ID='@owner:matrix\.example\.test'/u);
  assert.doesNotMatch(content, /owner-password|first-user-secret|access-secret/u);
  assert.equal((await stat(envFile)).mode & 0o777, 0o600);
});

test("owner registration logs out an unexpected access token before persisting ID", async () => {
  const envFile = await fixture();
  const fake = fakeRegistration({ userId: "@owner:matrix.example.test" });
  await registerOwner({
    homeserverUrl: "https://matrix.example.test",
    serverName: "matrix.example.test",
    username: "owner",
    password: "owner-password",
    registrationToken: "first-user-secret",
    envFile,
    fetchImplementation: fake.fetchImplementation
  });
  assert.match(fake.requests[2].url, /\/_matrix\/client\/v3\/logout$/u);
  assert.equal(fake.requests[2].authorization, "Bearer access-secret");
  assert.match(await readFile(envFile, "utf8"), /MATRIX_OWNER_ID='@owner:/u);
});

test("failed owner logout keeps reconciliation marker and does not persist ID", async () => {
  const envFile = await fixture();
  const fake = fakeRegistration({ userId: "@owner:matrix.example.test", logoutFails: true });
  await assert.rejects(
    registerOwner({
      homeserverUrl: "https://matrix.example.test",
      serverName: "matrix.example.test",
      username: "owner",
      password: "owner-password",
      registrationToken: "first-user-secret",
      envFile,
      fetchImplementation: fake.fetchImplementation
    }),
    MatrixRegistrationReconciliationError
  );
  assert.match(await readFile(envFile, "utf8"), /MATRIX_OWNER_ID=''/u);
  assert.match(
    await readFile(`${envFile}.owner-registration-pending`, "utf8"),
    /Reconcile before retrying/u
  );
});

test("owner registration rejects a token the homeserver will not accept", async () => {
  const envFile = await fixture();
  const fake = fakeRegistration({
    userId: "@owner:matrix.example.test",
    finalResponse: {
      ok: false,
      status: 403,
      json: async () => ({ errcode: "M_FORBIDDEN" })
    }
  });
  await assert.rejects(
    registerOwner({
      homeserverUrl: "https://matrix.example.test",
      serverName: "matrix.example.test",
      username: "owner",
      password: "owner-password",
      registrationToken: "first-user-secret",
      envFile,
      fetchImplementation: fake.fetchImplementation
    }),
    /was rejected \(M_FORBIDDEN\)/u
  );
  assert.equal(fake.requests.length, 2);
  assert.match(await readFile(envFile, "utf8"), /MATRIX_OWNER_ID=''/u);
  await assert.rejects(readFile(`${envFile}.owner-registration-pending`), { code: "ENOENT" });
});

test("reconciles a registered owner by signing in and logging out before saving the ID", async () => {
  const envFile = await fixture();
  await writeFile(`${envFile}.owner-registration-pending`, "pending\n", { mode: 0o600 });
  const requests = [];
  const result = await reconcileOwnerRegistration({
    homeserverUrl: "https://matrix.example.test",
    serverName: "matrix.example.test",
    username: "owner",
    password: "owner-password",
    envFile,
    fetchImplementation: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith("/_matrix/client/v3/login")) {
        return {
          ok: true,
          json: async () => ({
            user_id: "@owner:matrix.example.test",
            access_token: "temporary-token"
          })
        };
      }
      if (String(url).endsWith("/_matrix/client/v3/logout")) return { ok: true };
      assert.fail(`Unexpected Matrix request: ${url}`);
    }
  });
  assert.deepEqual(result, { userId: "@owner:matrix.example.test" });
  assert.equal(JSON.parse(requests[0].options.body).password, "owner-password");
  assert.equal(requests[1].options.headers.authorization, "Bearer temporary-token");
  assert.match(await readFile(envFile, "utf8"), /MATRIX_OWNER_ID='@owner:matrix\.example\.test'/u);
  await assert.rejects(readFile(`${envFile}.owner-registration-pending`), { code: "ENOENT" });
});

test("failed owner verification keeps the pending marker and owner ID empty", async () => {
  const envFile = await fixture();
  await writeFile(`${envFile}.owner-registration-pending`, "pending\n", { mode: 0o600 });
  await assert.rejects(
    reconcileOwnerRegistration({
      homeserverUrl: "https://matrix.example.test",
      serverName: "matrix.example.test",
      username: "owner",
      password: "wrong-password",
      envFile,
      fetchImplementation: async () => ({ ok: false, status: 403 })
    }),
    /sign-in failed \(HTTP 403\)/u
  );
  assert.match(await readFile(envFile, "utf8"), /MATRIX_OWNER_ID=''/u);
  assert.match(await readFile(`${envFile}.owner-registration-pending`, "utf8"), /pending/u);
});

test("owner reconciliation keeps the marker if its temporary login cannot be logged out", async () => {
  const envFile = await fixture();
  await writeFile(`${envFile}.owner-registration-pending`, "pending\n", { mode: 0o600 });
  await assert.rejects(
    reconcileOwnerRegistration({
      homeserverUrl: "https://matrix.example.test",
      serverName: "matrix.example.test",
      username: "owner",
      password: "owner-password",
      envFile,
      fetchImplementation: async (url) =>
        String(url).endsWith("/_matrix/client/v3/login")
          ? {
              ok: true,
              json: async () => ({
                user_id: "@owner:matrix.example.test",
                access_token: "temporary-token"
              })
            }
          : { ok: false, status: 500 }
    }),
    MatrixRegistrationReconciliationError
  );
  assert.match(await readFile(envFile, "utf8"), /MATRIX_OWNER_ID=''/u);
  assert.match(await readFile(`${envFile}.owner-registration-pending`, "utf8"), /pending/u);
});

test("brain registration reads protected temporary token and persists credentials", async () => {
  const envFile = await fixture();
  const fake = fakeRegistration({ userId: "@brain:matrix.example.test" });
  await registerBrain({
    homeserverUrl: "https://matrix.example.test",
    serverName: "matrix.example.test",
    username: "brain",
    password: "brain-password",
    envFile,
    fetchImplementation: fake.fetchImplementation
  });
  assert.equal(fake.requests[1].body.auth.token, "brain-secret");
  const content = await readFile(envFile, "utf8");
  assert.match(content, /MATRIX_BRAIN_USER_ID='@brain:matrix\.example\.test'/u);
  assert.match(content, /MATRIX_ACCESS_TOKEN='access-secret'/u);
  assert.doesNotMatch(content, /brain-password/u);
});

test("unexpected Matrix ID requires reconciliation without storing credentials", async () => {
  const envFile = await fixture();
  const fake = fakeRegistration({ userId: "@someone:matrix.example.test" });
  await assert.rejects(
    registerBrain({
      homeserverUrl: "https://matrix.example.test",
      serverName: "matrix.example.test",
      username: "brain",
      password: "brain-password",
      envFile,
      fetchImplementation: fake.fetchImplementation
    }),
    MatrixRegistrationReconciliationError
  );
  assert.match(await readFile(envFile, "utf8"), /MATRIX_BRAIN_USER_ID=''/u);
  assert.match(
    await readFile(`${envFile}.brain-registration-pending`, "utf8"),
    /Reconcile before retrying/u
  );
});

test("lost final registration response leaves durable marker and blocks replay", async () => {
  const envFile = await fixture();
  const fake = fakeRegistration({ userId: "@brain:matrix.example.test", failFinal: true });
  const request = {
    homeserverUrl: "https://matrix.example.test",
    serverName: "matrix.example.test",
    username: "brain",
    password: "brain-password",
    envFile,
    fetchImplementation: fake.fetchImplementation
  };
  await assert.rejects(registerBrain(request), MatrixRegistrationReconciliationError);
  assert.match(
    await readFile(`${envFile}.brain-registration-pending`, "utf8"),
    /Reconcile before retrying/u
  );
  await assert.rejects(registerBrain(request), MatrixRegistrationReconciliationError);
  assert.equal(fake.requests.length, 3);
});

test("definite invalid-token response clears marker and allows corrected retry", async () => {
  const envFile = await fixture();
  const rejected = fakeRegistration({
    userId: "@brain:matrix.example.test",
    finalResponse: {
      ok: false,
      status: 401,
      json: async () => ({
        errcode: "M_FORBIDDEN",
        session: "registration-session",
        flows: [{ stages: ["m.login.registration_token"] }]
      })
    }
  });
  const request = {
    homeserverUrl: "https://matrix.example.test",
    serverName: "matrix.example.test",
    username: "brain",
    password: "brain-password",
    envFile,
    fetchImplementation: rejected.fetchImplementation
  };
  await assert.rejects(registerBrain(request), /was rejected \(M_FORBIDDEN\)/u);
  await assert.rejects(readFile(`${envFile}.brain-registration-pending`), { code: "ENOENT" });

  const accepted = fakeRegistration({ userId: "@brain:matrix.example.test" });
  await registerBrain({ ...request, fetchImplementation: accepted.fetchImplementation });
  assert.match(await readFile(envFile, "utf8"), /MATRIX_BRAIN_USER_ID='@brain:/u);
});

test("server error after final request retains marker for reconciliation", async () => {
  const envFile = await fixture();
  const fake = fakeRegistration({
    userId: "@brain:matrix.example.test",
    finalResponse: {
      ok: false,
      status: 500,
      json: async () => ({ errcode: "M_UNKNOWN" })
    }
  });
  await assert.rejects(
    registerBrain({
      homeserverUrl: "https://matrix.example.test",
      serverName: "matrix.example.test",
      username: "brain",
      password: "brain-password",
      envFile,
      fetchImplementation: fake.fetchImplementation
    }),
    MatrixRegistrationReconciliationError
  );
  assert.match(
    await readFile(`${envFile}.brain-registration-pending`, "utf8"),
    /Reconcile before retrying/u
  );
});

test("403 M_FORBIDDEN clears the pending marker", async () => {
  const envFile = await fixture();
  const fake = fakeRegistration({
    userId: "@brain:matrix.example.test",
    finalResponse: {
      ok: false,
      status: 403,
      json: async () => ({ errcode: "M_FORBIDDEN" })
    }
  });
  await assert.rejects(
    registerBrain({
      homeserverUrl: "https://matrix.example.test",
      serverName: "matrix.example.test",
      username: "brain",
      password: "brain-password",
      envFile,
      fetchImplementation: fake.fetchImplementation
    }),
    /was rejected \(M_FORBIDDEN\)/u
  );
  await assert.rejects(readFile(`${envFile}.brain-registration-pending`), { code: "ENOENT" });
});

test("400 invalid username permits corrected retry but user-in-use does not", async () => {
  const invalidEnvFile = await fixture();
  const invalid = fakeRegistration({
    userId: "@brain:matrix.example.test",
    finalResponse: {
      ok: false,
      status: 400,
      json: async () => ({ errcode: "M_INVALID_USERNAME" })
    }
  });
  const request = (envFile, fetchImplementation) => ({
    homeserverUrl: "https://matrix.example.test",
    serverName: "matrix.example.test",
    username: "brain",
    password: "brain-password",
    envFile,
    fetchImplementation
  });
  await assert.rejects(
    registerBrain(request(invalidEnvFile, invalid.fetchImplementation)),
    /M_INVALID_USERNAME/u
  );
  await assert.rejects(readFile(`${invalidEnvFile}.brain-registration-pending`), {
    code: "ENOENT"
  });

  const usedEnvFile = await fixture();
  const used = fakeRegistration({
    userId: "@brain:matrix.example.test",
    finalResponse: {
      ok: false,
      status: 400,
      json: async () => ({ errcode: "M_USER_IN_USE" })
    }
  });
  await assert.rejects(
    registerBrain(request(usedEnvFile, used.fetchImplementation)),
    MatrixRegistrationReconciliationError
  );
  assert.match(
    await readFile(`${usedEnvFile}.brain-registration-pending`, "utf8"),
    /Reconcile before retrying/u
  );
});
