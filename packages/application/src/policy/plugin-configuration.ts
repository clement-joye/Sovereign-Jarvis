import type { CompiledPluginV2 } from "@second-brain/contracts";

export type PluginConfigurationResult =
  | { configuration: Record<string, string | boolean | number>; credentialRef?: string }
  | { error: string };

/** Parses the non-secret workspace binding configuration declared by a plugin. */
export function parsePluginConfiguration(
  manifest: CompiledPluginV2,
  options: Readonly<Record<string, string>>
): PluginConfigurationResult {
  const unknown = unknownConfigurationKeys(manifest, options);
  if (unknown.length > 0) {
    return { error: `Unknown configuration for \`${manifest.id}\`: ${unknown.join(", ")}.` };
  }
  const configuration = parseConfigurationValues(manifest, options);
  if ("error" in configuration) return configuration;
  const credential = validateCredentialReference(manifest, options.credential);
  if ("error" in credential) return credential;
  return {
    configuration: configuration.value,
    ...(credential.credentialRef ? { credentialRef: credential.credentialRef } : {})
  };
}

function unknownConfigurationKeys(
  manifest: CompiledPluginV2,
  options: Readonly<Record<string, string>>
): string[] {
  const accepted = new Set([...Object.keys(manifest.configurationSchema), "credential"]);
  return Object.keys(options).filter((key) => !accepted.has(key));
}

function parseConfigurationValues(
  manifest: CompiledPluginV2,
  options: Readonly<Record<string, string>>
): { value: Record<string, string | boolean | number> } | { error: string } {
  const configuration: Record<string, string | boolean | number> = {};
  for (const [key, type] of Object.entries(manifest.configurationSchema)) {
    const parsed = parseConfigurationValue(key, type, options[key]);
    if ("error" in parsed) return parsed;
    configuration[key] = parsed.value;
  }
  return { value: configuration };
}

function parseConfigurationValue(
  key: string,
  type: "string" | "boolean" | "integer",
  value: string | undefined
): { value: string | boolean | number } | { error: string } {
  if (type === "boolean") {
    if (value === undefined) return { value: false };
    return value === "true" || value === "false"
      ? { value: value === "true" }
      : { error: `Configuration \`${key}\` must be \`true\` or \`false\`.` };
  }
  if (type === "integer") {
    return value !== undefined && /^-?\d+$/u.test(value)
      ? { value: Number(value) }
      : { error: `Configuration \`${key}\` must be an integer.` };
  }
  return value ? { value } : { error: `Missing required configuration: \`${key}=<value>\`.` };
}

function validateCredentialReference(
  manifest: CompiledPluginV2,
  credentialRef: string | undefined
): { credentialRef?: string } | { error: string } {
  if (manifest.credentialKind && !credentialRef) {
    return { error: `Plugin \`${manifest.id}\` requires \`credential=<reference>\`.` };
  }
  if (!manifest.credentialKind && credentialRef) {
    return { error: `Plugin \`${manifest.id}\` does not accept a credential reference.` };
  }
  if (credentialRef && !/^[a-z][a-z0-9-]{0,63}$/.test(credentialRef)) {
    return { error: "Credential references use lowercase letters, numbers, and hyphens only." };
  }
  return credentialRef ? { credentialRef } : {};
}
