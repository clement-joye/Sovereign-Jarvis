import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const modelId = "en_US-ljspeech-high";
const revision = "bae641dcb5a608cff81ccaf7ff018baaca1a33e1";
const modelSha256 = "5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a";
const configSha256 = "7e1f4634af596d83cca997fb7a931ba80b70f8a316a2655ee69c55365e0ace14";

test("Piper voice defaults use the pinned, checksum-verified LJ Speech voice", async () => {
  const [downloadScript, baseCompose, devCompose, productionCompose, productionEnv] =
    await Promise.all([
      readFile(new URL("deploy/scripts/models/download-piper-model.sh", root), "utf8"),
      readFile(new URL("deploy/compose/compose.base.yml", root), "utf8"),
      readFile(new URL("deploy/compose/compose.dev.overlay.yml", root), "utf8"),
      readFile(new URL("deploy/compose/compose.production.overlay.yml", root), "utf8"),
      readFile(new URL("deploy/compose/production.env.example", root), "utf8")
    ]);

  assert.match(downloadScript, new RegExp(`model=/opt/piper-models/${modelId}\\.onnx`));
  assert.match(
    downloadScript,
    new RegExp(`resolve/${revision}/en/en_US/ljspeech/high/${modelId}\\.onnx`)
  );

  for (const text of [baseCompose, devCompose, productionCompose, productionEnv]) {
    assert.equal(text.includes(modelSha256), true);
  }
  for (const text of [baseCompose, productionEnv]) assert.equal(text.includes(configSha256), true);
  for (const text of [devCompose, productionCompose]) {
    assert.equal(text.includes(modelId), true);
    assert.equal(text.includes("en_US-ryan-high"), false);
  }
});
