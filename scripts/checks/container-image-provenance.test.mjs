import assert from "node:assert/strict";
import test from "node:test";
import {
  getExternalImages,
  makeRecords,
  missingExpectedImageServices,
  parseEnv,
  runComposeConfig,
  validateImageReference
} from "./container-image-provenance.mjs";

test("environment parsing keeps image selections and never adds secret values to errors", () => {
  const env = parseEnv(
    "# release inputs\nPOSTGRES_IMAGE=registry.example/db@sha256:" +
      "a".repeat(64) +
      "\nPOSTGRES_PASSWORD='secret-value'\n"
  );

  assert.equal(env.POSTGRES_PASSWORD, "secret-value");
  assert.deepEqual(Object.keys(env), ["POSTGRES_IMAGE", "POSTGRES_PASSWORD"]);
  assert.throws(
    () => parseEnv("NOT AN ASSIGNMENT secret-value"),
    (error) => {
      assert.equal(error.message.includes("secret-value"), false);
      return true;
    }
  );
});

test("image validation accepts immutable sha256 references and rejects tags or malformed digests", () => {
  assert.equal(validateImageReference(`registry.example/team/db@sha256:${"a".repeat(64)}`), true);
  assert.equal(validateImageReference("postgres:16-alpine"), false);
  assert.equal(validateImageReference(`postgres@sha256:${"A".repeat(64)}`), false);
  assert.equal(validateImageReference(`postgres@sha256:${"a".repeat(63)}`), false);
  assert.equal(validateImageReference(undefined), false);
});

test("image inventory includes external allowlisted images and omits build-only services", () => {
  const images = getExternalImages({
    "brain-db": { image: `postgres@sha256:${"a".repeat(64)}` },
    "matrix-homeserver": {
      image: `continuwuity@sha256:${"b".repeat(64)}`
    },
    "brain-control": { build: { context: "../.." } },
    loki: { image: `grafana/loki@sha256:${"c".repeat(64)}` }
  });

  assert.deepEqual(
    images.map(({ service }) => service),
    ["brain-db", "matrix-homeserver", "loki"]
  );
  assert.deepEqual(
    missingExpectedImageServices(
      {
        "brain-db": {},
        "matrix-homeserver": {},
        "brain-control": { build: { context: "../.." } }
      },
      false
    ),
    []
  );
  assert.deepEqual(
    missingExpectedImageServices({ "brain-db": {}, "matrix-homeserver": {} }, true),
    ["loki", "alloy", "prometheus", "grafana"]
  );
  assert.equal(makeRecords(images)[0].license, null);
  assert.equal(JSON.stringify(makeRecords(images)).includes("secret-value"), false);
});

test("Compose subprocess errors and stderr are suppressed to prevent env value leaks", () => {
  let options;
  assert.throws(
    () =>
      runComposeConfig(
        (_command, _args, receivedOptions) => {
          options = receivedOptions;
          throw new Error("Compose echoed secret-value in its stderr");
        },
        ["compose"],
        "/repo"
      ),
    (error) => {
      assert.equal(error.message, "Could not resolve production Compose configuration.");
      assert.equal(error.message.includes("secret-value"), false);
      return true;
    }
  );
  assert.deepEqual(options.stdio, ["ignore", "pipe", "ignore"]);
});
