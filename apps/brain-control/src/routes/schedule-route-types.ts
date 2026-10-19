import type { IncomingMessage, ServerResponse } from "node:http";

import type { ScheduleApprovalService, ScheduleService } from "@second-brain/application";
import type { IdGeneratorPort } from "@second-brain/domain";

import type { ApprovalPromptPublisher } from "../approvals/approval-prompt-publisher.js";
import type {
  RunAuthorizationClaims,
  RunAuthorizationService
} from "../authorization/run-authorization.js";

export type ReadJson = (request: IncomingMessage) => Promise<unknown>;
export type WriteJson = (response: ServerResponse, statusCode: number, body: unknown) => void;

export interface ScheduleRouteDependencies {
  scheduleService: ScheduleService;
  scheduleApprovals?: ScheduleApprovalService;
  ids: IdGeneratorPort;
  readJson: ReadJson;
  writeJson: WriteJson;
  scheduleToken?: string;
  runAuthorizations?: RunAuthorizationService;
  approvalPrompts?: Pick<ApprovalPromptPublisher, "publish">;
}

export interface ScheduleRouteAccess {
  workspaceId: string | undefined;
  runAuthorization: RunAuthorizationClaims | undefined;
}

export interface ScheduleRouteCall extends ScheduleRouteAccess {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  dependencies: ScheduleRouteDependencies;
}
