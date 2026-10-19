import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const eventTypes = [
  "authorization.denied",
  "catalog.mismatch",
  "approval.consumed",
  "workspace_path.denied",
  "plugin.failure"
];

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const [source, dashboardText, alertRules, alloyConfig, compose] = await Promise.all([
  read("packages/observability/src/security-events.ts"),
  read("deploy/observability/grafana/dashboards/jarvis-security-events.json"),
  read("deploy/observability/grafana/provisioning/alerting/security-events.yml"),
  read("deploy/observability/alloy/config.alloy"),
  read("deploy/compose/compose.observability.yml")
]);

const dashboard = JSON.parse(dashboardText);
assert.equal(dashboard.uid, "jarvis-security-events");

for (const eventType of eventTypes) {
  assert.match(source, new RegExp(`"${eventType.replace(".", "\\.")}"`));
  assert.ok(dashboardText.includes(`security_event_type=\\"${eventType}\\"`));
  assert.ok(alertRules.includes(`security_event_type: ${eventType}`));
}

assert.equal(
  [...source.matchAll(/^  "([a-z_.]+)"[,]?$/gm)].map((match) => match[1]).length,
  eventTypes.length,
  "update the provisioned dashboard and alerts when the stable event vocabulary changes"
);
assert.equal(alloyConfig.match(/action\s+= "drop"/g)?.length, 2);
assert.ok(alloyConfig.includes('!~ \\"security event\\"'));
for (const eventType of eventTypes) {
  assert.ok(alloyConfig.includes(eventType.replaceAll(".", "[.]")));
}
assert.ok(!compose.includes("/var/run/docker.sock"));
assert.ok(compose.includes('"127.0.0.1:${GRAFANA_HOST_PORT:-3001}:3000"'));
assert.ok(compose.includes('"127.0.0.1:${PROMETHEUS_HOST_PORT:-9091}:9090"'));

console.log("Security observability configuration is consistent.");
