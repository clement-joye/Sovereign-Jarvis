const appNames = [
  "brain-cli",
  "brain-control",
  "brain-worker",
  "matrix-gateway",
  "media-worker",
  "pi-runner",
  "retention-worker",
  "scheduler"
];

const crossAppImportRules = appNames.map((appName) => ({
  name: `app-${appName}-does-not-import-other-apps`,
  severity: "error",
  from: { path: `^apps/${appName}/src` },
  to: { path: `^apps/(?!${appName}/)` }
}));

module.exports = {
  forbidden: [
    {
      name: "domain-is-platform-neutral",
      severity: "error",
      from: { path: "^packages/domain/src" },
      to: {
        path: "^(packages/(matrix-adapter|pi-adapter|postgres-adapter|media-adapter)|apps)/"
      }
    },
    {
      name: "application-does-not-import-adapters",
      severity: "error",
      from: { path: "^packages/application/src" },
      to: { path: "^packages/(matrix-adapter|pi-adapter|postgres-adapter|media-adapter)/src" }
    },
    {
      name: "matrix-adapter-does-not-import-other-adapters",
      severity: "error",
      from: { path: "^packages/matrix-adapter/src" },
      to: { path: "^packages/(pi-adapter|media-adapter|postgres-adapter)/src" }
    },
    {
      name: "pi-adapter-does-not-import-other-adapters",
      severity: "error",
      from: { path: "^packages/pi-adapter/src" },
      to: { path: "^packages/(matrix-adapter|media-adapter|postgres-adapter)/src" }
    },
    {
      name: "media-adapter-does-not-import-other-adapters",
      severity: "error",
      from: { path: "^packages/media-adapter/src" },
      to: { path: "^packages/(matrix-adapter|pi-adapter|postgres-adapter)/src" }
    },
    {
      name: "postgres-adapter-does-not-import-other-adapters",
      severity: "error",
      from: { path: "^packages/postgres-adapter/src" },
      to: { path: "^packages/(matrix-adapter|pi-adapter|media-adapter)/src" }
    },
    ...crossAppImportRules,
    {
      name: "pi-runner-does-not-import-postgres-adapter",
      severity: "error",
      from: { path: "^apps/pi-runner/src" },
      to: { path: "^packages/postgres-adapter/src" }
    }
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "node", "default"]
    }
  }
};
