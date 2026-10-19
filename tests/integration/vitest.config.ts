import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@second-brain/application/ports/agents": `${root}/packages/application/src/ports/agents.ts`,
      "@second-brain/application/ports/approvals": `${root}/packages/application/src/ports/approvals.ts`,
      "@second-brain/application/ports/jobs": `${root}/packages/application/src/ports/jobs.ts`,
      "@second-brain/application/ports/media": `${root}/packages/application/src/ports/media.ts`,
      "@second-brain/application/ports/scheduling": `${root}/packages/application/src/ports/scheduling.ts`,
      "@second-brain/application/ports/sessions": `${root}/packages/application/src/ports/sessions.ts`,
      "@second-brain/application/ports/workspace": `${root}/packages/application/src/ports/workspace.ts`,
      "@second-brain/application/ports": `${root}/packages/application/src/ports.ts`,
      "@second-brain/application": `${root}/packages/application/src/index.ts`,
      "@second-brain/configuration": `${root}/packages/configuration/src/index.ts`,
      "@second-brain/contracts/examples": `${root}/packages/contracts/src/examples.ts`,
      "@second-brain/contracts/internal-api-routes": `${root}/packages/contracts/src/internal-api-routes.ts`,
      "@second-brain/contracts/platform-catalog": `${root}/packages/contracts/src/platform-catalog.ts`,
      "@second-brain/contracts/schemas": `${root}/packages/contracts/src/schemas.ts`,
      "@second-brain/contracts": `${root}/packages/contracts/src/index.ts`,
      "@second-brain/domain": `${root}/packages/domain/src/index.ts`,
      "@second-brain/matrix-adapter": `${root}/packages/matrix-adapter/src/index.ts`,
      "@second-brain/media-adapter": `${root}/packages/media-adapter/src/index.ts`,
      "@second-brain/memory-adapter": `${root}/packages/memory-adapter/src/index.ts`,
      "@second-brain/observability": `${root}/packages/observability/src/index.ts`,
      "@second-brain/pi-adapter": `${root}/packages/pi-adapter/src/index.ts`,
      "@second-brain/postgres-adapter": `${root}/packages/postgres-adapter/src/index.ts`,
      "@second-brain/schedule-engine": `${root}/packages/schedule-engine/src/index.ts`,
      "@second-brain/testkit/fakes": `${root}/packages/testkit/src/fakes.ts`,
      "@second-brain/testkit": `${root}/packages/testkit/src/index.ts`,
      "@second-brain/brain-control": `${root}/apps/brain-control/src/index.ts`,
      "@second-brain/brain-worker": `${root}/apps/brain-worker/src/index.ts`,
      "@second-brain/matrix-gateway": `${root}/apps/matrix-gateway/src/index.ts`,
      "@second-brain/pi-runner": `${root}/apps/pi-runner/src/index.ts`
    }
  },
  test: {
    environment: "node",
    fileParallelism: false,
    globals: false,
    hookTimeout: 120_000,
    include: ["postgres/*.integration.ts", "control-plane/*.integration.ts"]
  }
});
