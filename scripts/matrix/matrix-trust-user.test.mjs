import assert from "node:assert/strict";
import { sign, verify, createPublicKey } from "node:crypto";
import test from "node:test";

import {
  canonicalJson,
  privateKeyFromSeed,
  publicKeyFromPrivateKey,
  toUnpaddedBase64,
  withSignature,
  withoutSignatures
} from "./matrix-trust-user.mjs";

test("canonicalizes a cross-signing key without signatures", () => {
  const key = {
    user_id: "@brain:example",
    usage: ["master"],
    keys: { "ed25519:abc": "abc" },
    unsigned: { ignored: true },
    signatures: { "@brain:example": { "ed25519:abc": "signature" } }
  };

  assert.equal(
    canonicalJson(withoutSignatures(key)),
    '{"keys":{"ed25519:abc":"abc"},"usage":["master"],"user_id":"@brain:example"}'
  );
});

test("derives the Matrix public key and signs a pinned identity", () => {
  const seed = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
  const privateKey = privateKeyFromSeed(toUnpaddedBase64(seed));
  const publicKey = createPublicKey(privateKey);
  const signature = sign(null, Buffer.from('{"keys":{}}'), privateKey);

  assert.equal(publicKeyFromPrivateKey(privateKey).length, 43);
  assert.equal(verify(null, Buffer.from('{"keys":{}}'), publicKey, signature), true);
});

test("adds the owner signature without replacing existing signatures", () => {
  const result = withSignature(
    { signatures: { "@brain:example": { "ed25519:brain": "self" } } },
    "@owner:example",
    "ed25519:owner",
    "owner-signature"
  );

  assert.deepEqual(result.signatures, {
    "@brain:example": { "ed25519:brain": "self" },
    "@owner:example": { "ed25519:owner": "owner-signature" }
  });
});
