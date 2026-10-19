import assert from "node:assert/strict";
import test from "node:test";
import {
  PINNED_PIPER_ARCHIVES,
  PINNED_TASHKEEL_MODEL_SHA256,
  verifyPiperArchiveFacts,
  validateArchiveMembers
} from "./inventory-piper-archives.mjs";

test("Piper archive inventory pins both release archive digests", () => {
  assert.equal(
    PINNED_PIPER_ARCHIVES.x86_64,
    "a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992"
  );
  assert.equal(
    PINNED_PIPER_ARCHIVES.aarch64,
    "fea0fd2d87c54dbc7078d0f878289f404bd4d6eea6e7444a77835d1537ab88eb"
  );
});

test("Piper archive inventory pins the extracted tashkeel ONNX model digest", () => {
  assert.equal(
    PINNED_TASHKEEL_MODEL_SHA256,
    "9f27090af3e0f661913af048a739632a3f577b3233512551d8c90580ccad4aa8"
  );
});

test("Piper archive inventory sorts safe paths and rejects unsafe or duplicate members", () => {
  assert.deepEqual(validateArchiveMembers(["piper/lib/libpiper.so", "piper/LICENSE"]), [
    "piper/LICENSE",
    "piper/lib/libpiper.so"
  ]);
  for (const members of [
    ["../escape"],
    ["/absolute"],
    ["piper/../escape"],
    ["piper/LICENSE", "piper/LICENSE"]
  ]) {
    assert.throws(() => validateArchiveMembers(members), /Unsafe|Duplicate/);
  }
});

test("Piper archive inventory confirms its embedded runtime components and absent notice files", () => {
  const facts = verifyPiperArchiveFacts([
    "piper/espeak-ng",
    "piper/espeak-ng-data",
    "piper/espeak-ng-data/voices/en-us",
    "piper/libespeak-ng.so.1.52.0.1",
    "piper/libonnxruntime.so.1.14.1",
    "piper/libpiper_phonemize.so.1.2.0",
    "piper/libtashkeel_model.ort",
    "piper/piper",
    "piper/piper_phonemize"
  ]);
  assert.equal(facts.memberCount, 9);
  assert.throws(
    () =>
      verifyPiperArchiveFacts([
        "piper/LICENSE",
        "piper/espeak-ng",
        "piper/espeak-ng-data",
        "piper/libespeak-ng.so.1.52.0.1",
        "piper/libonnxruntime.so.1.14.1",
        "piper/libpiper_phonemize.so.1.2.0",
        "piper/libtashkeel_model.ort",
        "piper/piper",
        "piper/piper_phonemize"
      ]),
    /unexpectedly contains license\/notice files/
  );
  for (const noticePath of ["piper/LICENSE-MIT", "piper/COPYING3", "piper/NOTICE.md"]) {
    assert.throws(
      () =>
        verifyPiperArchiveFacts([
          "piper/espeak-ng",
          "piper/espeak-ng-data",
          "piper/libespeak-ng.so.1.52.0.1",
          "piper/libonnxruntime.so.1.14.1",
          "piper/libpiper_phonemize.so.1.2.0",
          "piper/libtashkeel_model.ort",
          "piper/piper",
          "piper/piper_phonemize",
          noticePath
        ]),
      /unexpectedly contains license\/notice files/
    );
  }
});
