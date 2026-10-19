import type { InternalApiRoute } from "../internal-api-route-types.js";
import {
  ConversationSessionContextRequestV1Schema,
  ConversationSessionContextResponseV1Schema,
  ConversationVoicePreferenceRequestV1Schema,
  ConversationVoicePreferenceResponseV1Schema,
  InboundMessageV1Schema,
  ScheduledExecutionV1Schema,
  SessionBindingActivateRequestV1Schema,
  SessionBindingLookupRequestV1Schema,
  SessionCreateAndBindRequestV1Schema,
  SessionRecordV1Schema
} from "../schemas.js";

export const SessionsInternalApiRoutes: readonly InternalApiRoute[] = [
  {
    method: "GET",
    path: "/v1/sessions",
    operationId: "listSessions",
    summary: "List recent sessions",
    responses: {
      "200": { description: "Recent sessions", arrayOf: SessionRecordV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/conversation-preferences/session-context",
    operationId: "getOrSetSessionContextPreferences",
    summary: "Read or update a conversation's session context preference",
    requestSchema: ConversationSessionContextRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": {
        description: "Current session context preference",
        schema: ConversationSessionContextResponseV1Schema
      }
    }
  },
  {
    method: "POST",
    path: "/v1/sessions",
    operationId: "createSession",
    summary: "Create a new session",
    requestSchema: SessionRecordV1Schema.omit({ id: true, label: true }),
    requestRequired: true,
    responses: {
      "201": { description: "Session created", schema: SessionRecordV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/sessions/active-binding",
    operationId: "lookupActiveBinding",
    summary: "Look up the active session binding for a conversation",
    requestSchema: SessionBindingLookupRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": { description: "Active binding, or null", schema: SessionRecordV1Schema.nullable() }
    }
  },
  {
    method: "POST",
    path: "/v1/sessions/bind",
    operationId: "createAndBindSession",
    summary: "Create a session and bind it to a conversation",
    requestSchema: SessionCreateAndBindRequestV1Schema,
    requestRequired: true,
    responses: {
      "201": { description: "Session created and bound", schema: SessionRecordV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/sessions/activate",
    operationId: "activateSessionBinding",
    summary: "Activate an existing session binding",
    requestSchema: SessionBindingActivateRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": { description: "Binding activated", schema: SessionRecordV1Schema }
    }
  },
  {
    method: "GET",
    path: "/v1/sessions/{id}",
    operationId: "getSession",
    summary: "Fetch a session by id",
    pathParam: "id",
    responses: {
      "200": { description: "Session found", schema: SessionRecordV1Schema },
      "404": { description: "Session not found" }
    }
  },
  {
    method: "POST",
    path: "/v1/sessions/{id}/touch",
    operationId: "touchSession",
    summary: "Refresh the lastActiveAt timestamp on a session",
    pathParam: "id",
    responses: {
      "200": { description: "Session touched", schema: SessionRecordV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/sessions/{id}/close",
    operationId: "closeSession",
    summary: "Close an existing session",
    pathParam: "id",
    responses: {
      "200": { description: "Session closed", schema: SessionRecordV1Schema }
    }
  },
  {
    method: "GET",
    path: "/v1/executions/{id}",
    operationId: "getExecution",
    summary: "Fetch a scheduled execution by id",
    pathParam: "id",
    responses: {
      "200": { description: "Execution found", schema: ScheduledExecutionV1Schema },
      "404": { description: "Execution not found" }
    }
  },
  {
    method: "PUT",
    path: "/v1/executions/{id}",
    operationId: "updateExecution",
    summary: "Update a scheduled execution record",
    pathParam: "id",
    requestSchema: ScheduledExecutionV1Schema,
    requestRequired: true,
    responses: {
      "200": { description: "Execution updated", schema: ScheduledExecutionV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/session-routing/matrix",
    operationId: "routeMatrixInbound",
    summary: "Dispatch a Matrix inbound message through session routing",
    requestSchema: InboundMessageV1Schema,
    requestRequired: true,
    responses: {
      "200": { description: "Inbound dispatched", schema: InboundMessageV1Schema }
    }
  },
  {
    method: "POST",
    path: "/v1/conversation-preferences/voice",
    operationId: "getOrSetVoicePreferences",
    summary: "Read or update a conversation's voice reply preference",
    requestSchema: ConversationVoicePreferenceRequestV1Schema,
    requestRequired: true,
    responses: {
      "200": {
        description: "Current preference",
        schema: ConversationVoicePreferenceResponseV1Schema
      }
    }
  }
];
