import { z } from "zod";

import {
  AgentIdV1Schema,
  NonEmptyString,
  OpaqueId,
  RelativeResourcePath,
  SchemaVersionV1,
  Sha256Digest,
  TemplateIdentifier,
  TemplateVersion
} from "./common.js";

export const WorkspaceTemplateOnboardingFieldV1Schema = z
  .object({
    id: TemplateIdentifier,
    label: NonEmptyString,
    description: z.string().max(1_000).optional(),
    type: z.enum(["text", "boolean", "select"]),
    required: z.boolean(),
    options: z.array(NonEmptyString).min(1).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === "select" && !value.options) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select onboarding fields require options."
      });
    }
    if (value.type !== "select" && value.options) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only select onboarding fields may declare options."
      });
    }
  });
export type WorkspaceTemplateOnboardingFieldV1 = z.infer<
  typeof WorkspaceTemplateOnboardingFieldV1Schema
>;

export const WorkspaceTemplateManifestV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    id: TemplateIdentifier,
    version: TemplateVersion,
    displayName: NonEmptyString.max(120),
    description: z.string().max(2_000).optional(),
    runtimeClass: z.enum(["second-brain", "code-project"]),
    systemPromptPath: RelativeResourcePath.optional(),
    profileArtifact: z
      .object({
        id: TemplateIdentifier,
        digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        modelsPath: RelativeResourcePath
      })
      .strict(),
    skills: z.array(RelativeResourcePath),
    extensions: z.array(RelativeResourcePath),
    tools: z.array(TemplateIdentifier),
    capabilities: z
      .object({
        filesystem: z.enum(["read-only", "workspace-write"]),
        network: z.enum(["none", "restricted"]),
        subagents: z.boolean()
      })
      .strict(),
    onboarding: z.array(WorkspaceTemplateOnboardingFieldV1Schema)
  })
  .strict()
  .superRefine((value, ctx) => {
    const duplicateField = value.onboarding.find(
      (field, index) =>
        value.onboarding.findIndex((candidate) => candidate.id === field.id) !== index
    );
    if (duplicateField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate onboarding field id: ${duplicateField.id}.`
      });
    }
  });
export type WorkspaceTemplateManifestV1 = z.infer<typeof WorkspaceTemplateManifestV1Schema>;

/** A reviewed, image-packaged agent profile; never a runtime install recipe. */
export const ProfileArtifactManifestV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    id: TemplateIdentifier,
    version: TemplateVersion,
    source: z
      .object({
        repository: z.string().url(),
        revision: z.string().regex(/^[a-f0-9]{40}$/),
        digest: z.string().regex(/^sha256:[a-f0-9]{64}$/)
      })
      .strict(),
    runtimeImage: z
      .string()
      .regex(/^(?:[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}|sha256:[a-f0-9]{64})$/),
    modelsPath: RelativeResourcePath,
    resources: z
      .array(
        z
          .object({
            path: RelativeResourcePath,
            kind: z.enum(["extension", "skill", "configuration", "dependency"]),
            compatibility: z.enum([
              "sdk-compatible",
              "interactive-only",
              "host-dependent",
              "unsuitable"
            ]),
            rationale: NonEmptyString.max(1_000)
          })
          .strict()
      )
      .min(1)
  })
  .strict()
  .superRefine((value, ctx) => {
    const duplicate = value.resources.find(
      (resource, index) =>
        value.resources.findIndex((candidate) => candidate.path === resource.path) !== index
    );
    if (duplicate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate profile resource path: ${duplicate.path}.`
      });
    }
  });
export type ProfileArtifactManifestV1 = z.infer<typeof ProfileArtifactManifestV1Schema>;

/**
 * The one currently approved host-local runtime for a profile. The image ID is
 * immutable for a single run, while the manifest itself is atomically replaced
 * when an administrator updates the profile. This intentionally has no
 * release history or room-level image pinning.
 */
export const HostLocalRuntimeProfileManifestV1Schema = z
  .object({
    schemaVersion: SchemaVersionV1,
    profileArtifact: ProfileArtifactManifestV1Schema,
    currentRuntime: z
      .object({
        templateId: TemplateIdentifier,
        templateVersion: TemplateVersion,
        imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        // Retained only so manifests written before runtime classes can still be read.
        agentImageIds: z
          .object({
            brain: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            code: z.string().regex(/^sha256:[a-f0-9]{64}$/)
          })
          .strict()
          .optional(),
        runtimeImageIds: z
          .record(
            z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
            z.string().regex(/^sha256:[a-f0-9]{64}$/)
          )
          .optional(),
        // Optional for compatibility with manifests written before resource
        // bundles were separated from executable runtime images. The bundle
        // is identified by content digest and a release-relative artifact
        // name; it never contains an arbitrary host filesystem path.
        resourceBundle: z
          .object({
            digest: Sha256Digest,
            artifactName: RelativeResourcePath
          })
          .strict()
          .optional(),
        network: z.enum(["none", "restricted"]),
        modelNetwork: z.enum(["none", "restricted"]).default("none")
      })
      .strict()
  })
  .strict();
export type HostLocalRuntimeProfileManifestV1 = z.infer<
  typeof HostLocalRuntimeProfileManifestV1Schema
>;

/** Internal-only request used by trusted transport services to resolve room ownership. */
export const WorkspaceRoomResolutionRequestV1Schema = z
  .object({
    roomId: OpaqueId,
    threadRootExternalEventId: OpaqueId.optional()
  })
  .strict();
export type WorkspaceRoomResolutionRequestV1 = z.infer<
  typeof WorkspaceRoomResolutionRequestV1Schema
>;

/** The resolved scope is authoritative; callers must never provide it for an inbound event. */
export const WorkspaceRoomResolutionResponseV1Schema = z
  .object({
    workspaceId: OpaqueId,
    templateId: z.string().min(1),
    templateVersion: z.string().min(1),
    defaultAgent: AgentIdV1Schema.optional(),
    selectedAgent: AgentIdV1Schema.optional(),
    status: z.string().min(1).optional()
  })
  .strict();
export type WorkspaceRoomResolutionResponseV1 = z.infer<
  typeof WorkspaceRoomResolutionResponseV1Schema
>;

/** Internal-only request from the Matrix gateway after it validated an invite. */
export const WorkspaceInviteAcceptanceRequestV1Schema = z
  .object({
    roomId: OpaqueId
  })
  .strict();
export type WorkspaceInviteAcceptanceRequestV1 = z.infer<
  typeof WorkspaceInviteAcceptanceRequestV1Schema
>;

export const WorkspaceInviteAcceptanceResponseV1Schema =
  WorkspaceRoomResolutionResponseV1Schema.extend({
    created: z.boolean()
  }).strict();
export type WorkspaceInviteAcceptanceResponseV1 = z.infer<
  typeof WorkspaceInviteAcceptanceResponseV1Schema
>;

/** Trusted Matrix command envelope; command services interpret the text by capability. */
const RoomCommandRequestV1Schema = z
  .object({
    roomId: OpaqueId,
    externalEventId: OpaqueId,
    traceId: OpaqueId,
    text: NonEmptyString,
    threadRootExternalEventId: OpaqueId.optional()
  })
  .strict();

/** Trusted Matrix-gateway request for a room lifecycle command. */
export const RoomLifecycleCommandRequestV1Schema = RoomCommandRequestV1Schema;
export type RoomLifecycleCommandRequestV1 = z.infer<typeof RoomLifecycleCommandRequestV1Schema>;

export const RoomLifecycleCommandResponseV1Schema = z.object({ handled: z.boolean() }).strict();
export type RoomLifecycleCommandResponseV1 = z.infer<typeof RoomLifecycleCommandResponseV1Schema>;

/** Trusted Matrix-gateway request for a room agent command. */
export const RoomAgentCommandRequestV1Schema = RoomCommandRequestV1Schema;
export type RoomAgentCommandRequestV1 = z.infer<typeof RoomAgentCommandRequestV1Schema>;

export const RoomAgentCommandResponseV1Schema = z.object({ handled: z.boolean() }).strict();
export type RoomAgentCommandResponseV1 = z.infer<typeof RoomAgentCommandResponseV1Schema>;

/** Trusted Matrix-gateway request for an owner-authorized room plugin command. */
export const RoomPluginCommandRequestV1Schema = RoomAgentCommandRequestV1Schema;
export type RoomPluginCommandRequestV1 = z.infer<typeof RoomPluginCommandRequestV1Schema>;

export const RoomPluginCommandResponseV1Schema = z.object({ handled: z.boolean() }).strict();
export type RoomPluginCommandResponseV1 = z.infer<typeof RoomPluginCommandResponseV1Schema>;

export const WorkspaceRoomArchiveResponseV1Schema = z.object({ archived: z.boolean() }).strict();
export type WorkspaceRoomArchiveResponseV1 = z.infer<typeof WorkspaceRoomArchiveResponseV1Schema>;

/** Result of recovering the runtime belonging to a trusted Matrix room. */
export const WorkspaceRoomRuntimeRecoveryResponseV1Schema = z
  .object({
    status: z.literal("active")
  })
  .strict();
export type WorkspaceRoomRuntimeRecoveryResponseV1 = z.infer<
  typeof WorkspaceRoomRuntimeRecoveryResponseV1Schema
>;
