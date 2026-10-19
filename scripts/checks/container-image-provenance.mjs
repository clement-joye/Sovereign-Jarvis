export const observabilityVariables = [
  "LOKI_IMAGE",
  "ALLOY_IMAGE",
  "PROMETHEUS_IMAGE",
  "GRAFANA_IMAGE"
];

const externalServices = new Map([
  ["brain-db", "POSTGRES_IMAGE"],
  ["matrix-homeserver", null],
  ["loki", "LOKI_IMAGE"],
  ["alloy", "ALLOY_IMAGE"],
  ["prometheus", "PROMETHEUS_IMAGE"],
  ["grafana", "GRAFANA_IMAGE"]
]);

export function parseEnv(contents) {
  const result = Object.create(null);
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`Invalid environment assignment on line ${index + 1}.`);
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

export function validateImageReference(reference) {
  return typeof reference === "string" && /^\S+@sha256:[a-f0-9]{64}$/.test(reference);
}

export function getExternalImages(services) {
  return [...externalServices].flatMap(([service, variable]) => {
    const config = services[service];
    if (!config) return [];
    return [{ service, variable, reference: config.image ?? null }];
  });
}

export function missingExpectedImageServices(services, includeObservability) {
  const expected = ["brain-db", "matrix-homeserver"];
  if (includeObservability) expected.push("loki", "alloy", "prometheus", "grafana");
  return expected.filter((service) => !services[service]);
}

export function makeRecords(images) {
  return images.map(({ service, variable, reference }) => ({
    service,
    environmentVariable: variable,
    image: reference,
    digest: reference.slice(reference.lastIndexOf("@sha256:") + 8),
    sourceUrl: null,
    license: null,
    licenseEvidence: null,
    reviewStatus: "source-and-license-review-required"
  }));
}

export function runComposeConfig(execFile, args, cwd) {
  try {
    const result = execFile("docker", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return JSON.parse(result);
  } catch {
    // Compose interpolation errors can echo protected environment values.
    throw new Error("Could not resolve production Compose configuration.");
  }
}
