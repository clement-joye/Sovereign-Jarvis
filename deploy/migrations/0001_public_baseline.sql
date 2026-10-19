-- Jarvis public database baseline.
-- Generated from the final catalog state of private migrations 0001-0032.
-- Public migration numbering starts here; future migrations begin at 0002.

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: brain_audit; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA brain_audit;


--
-- Name: brain_core; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA brain_core;


--
-- Name: brain_jobs; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA brain_jobs;


--
-- Name: valid_agent_identifiers(text[]); Type: FUNCTION; Schema: brain_core; Owner: -
--

CREATE FUNCTION brain_core.valid_agent_identifiers(agent_ids text[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$
  SELECT cardinality(agent_ids) > 0
    AND COALESCE(bool_and(agent_id ~ '^[a-z][a-z0-9-]{0,63}$'), false)
  FROM unnest(agent_ids) AS agent_id;
$_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_events; Type: TABLE; Schema: brain_audit; Owner: -
--

CREATE TABLE brain_audit.audit_events (
    id text NOT NULL,
    actor text NOT NULL,
    operation text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    outcome text NOT NULL,
    trace_id text,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id text NOT NULL
);


--
-- Name: action_approval_policies; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.action_approval_policies (
    workspace_id text NOT NULL,
    plugin_id text NOT NULL,
    operation_id text NOT NULL,
    mode text DEFAULT 'owner'::text NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT action_approval_policies_mode_check CHECK ((mode = 'owner'::text))
);


--
-- Name: action_proposals; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.action_proposals (
    id text NOT NULL,
    schema_version integer NOT NULL,
    operation_digest text NOT NULL,
    workspace_id text NOT NULL,
    agent_id text NOT NULL,
    run_id text NOT NULL,
    plugin_id text NOT NULL,
    capability_id text NOT NULL,
    operation_id text NOT NULL,
    operation_version text NOT NULL,
    summary text NOT NULL,
    parameters jsonb NOT NULL,
    approval_mode text NOT NULL,
    required_approver text NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    decided_at timestamp with time zone,
    decided_by text,
    decision_workspace_id text,
    decision_owner_id text,
    decision_external_event_id text,
    decision_reason text,
    approval_prompt_outbound_id text,
    CONSTRAINT action_proposals_approval_binding_check CHECK ((((approval_mode = 'owner'::text) AND (required_approver = 'owner'::text)) OR ((approval_mode = 'none'::text) AND (required_approver = 'none'::text)))),
    CONSTRAINT action_proposals_approval_mode_check CHECK ((approval_mode = ANY (ARRAY['none'::text, 'owner'::text]))),
    CONSTRAINT action_proposals_decision_actor_check CHECK (((decided_by IS NULL) OR (decided_by = 'owner'::text))),
    CONSTRAINT action_proposals_decision_metadata_check CHECK ((((decided_at IS NULL) AND (decided_by IS NULL) AND (decision_workspace_id IS NULL) AND (decision_owner_id IS NULL) AND (decision_external_event_id IS NULL) AND (decision_reason IS NULL)) OR ((decided_at IS NOT NULL) AND (decided_by = 'owner'::text) AND (decision_workspace_id IS NOT NULL) AND (decision_owner_id IS NOT NULL) AND (decision_external_event_id IS NOT NULL)))),
    CONSTRAINT action_proposals_decision_workspace_check CHECK (((decision_workspace_id IS NULL) OR (decision_workspace_id = workspace_id))),
    CONSTRAINT action_proposals_digest_check CHECK ((operation_digest ~ '^sha256:[a-f0-9]{64}$'::text)),
    CONSTRAINT action_proposals_expiry_check CHECK ((expires_at > created_at)),
    CONSTRAINT action_proposals_parameters_check CHECK ((jsonb_typeof(parameters) = 'object'::text)),
    CONSTRAINT action_proposals_required_approver_check CHECK ((required_approver = ANY (ARRAY['none'::text, 'owner'::text]))),
    CONSTRAINT action_proposals_schema_version_check CHECK ((schema_version = 1)),
    CONSTRAINT action_proposals_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'rejected'::text, 'consumed'::text, 'expired'::text, 'cancelled'::text])))
);


--
-- Name: agent_artifacts; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.agent_artifacts (
    id text NOT NULL,
    workspace_id text NOT NULL,
    producing_run_id text NOT NULL,
    parent_run_id text,
    agent_id text NOT NULL,
    catalog_version text NOT NULL,
    catalog_digest text NOT NULL,
    kind text NOT NULL,
    storage_key text NOT NULL,
    sha256 text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT agent_artifacts_catalog_digest_check CHECK ((catalog_digest ~ '^sha256:[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_artifacts_kind_check CHECK ((kind = ANY (ARRAY['analysis'::text, 'plan'::text, 'research'::text, 'draft'::text, 'evidence'::text]))),
    CONSTRAINT agent_artifacts_sha256_check CHECK ((sha256 ~ '^[a-f0-9]{64}$'::text))
);


--
-- Name: agent_runs; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.agent_runs (
    id text NOT NULL,
    workspace_id text NOT NULL,
    agent_id text NOT NULL,
    catalog_version text NOT NULL,
    catalog_digest text NOT NULL,
    status text NOT NULL,
    parent_run_id text,
    delegation_grant_id text,
    deadline_at timestamp with time zone NOT NULL,
    timeout_seconds integer NOT NULL,
    token_budget integer,
    created_at timestamp with time zone NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    result_text text,
    root_run_id text NOT NULL,
    effective_policy_digest text,
    platform_policy_digest text,
    resource_digest text,
    runtime_image_id text,
    CONSTRAINT agent_runs_catalog_digest_check CHECK ((catalog_digest ~ '^sha256:[a-f0-9]{64}$'::text)),
    CONSTRAINT agent_runs_effective_policy_digest_check CHECK (((effective_policy_digest IS NULL) OR (effective_policy_digest ~ '^sha256:[a-f0-9]{64}$'::text))),
    CONSTRAINT agent_runs_platform_policy_digest_check CHECK (((platform_policy_digest IS NULL) OR (platform_policy_digest ~ '^sha256:[a-f0-9]{64}$'::text))),
    CONSTRAINT agent_runs_resource_digest_check CHECK (((resource_digest IS NULL) OR (resource_digest ~ '^sha256:[a-f0-9]{64}$'::text))),
    CONSTRAINT agent_runs_result_text_size_check CHECK (((result_text IS NULL) OR (length(result_text) <= 100000))),
    CONSTRAINT agent_runs_root_identity_check CHECK (((parent_run_id IS NOT NULL) OR (root_run_id = id))),
    CONSTRAINT agent_runs_runtime_image_id_check CHECK (((runtime_image_id IS NULL) OR (runtime_image_id ~ '^([a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}|sha256:[a-f0-9]{64})$'::text))),
    CONSTRAINT agent_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT agent_runs_timeout_check CHECK ((timeout_seconds > 0)),
    CONSTRAINT agent_runs_token_budget_check CHECK ((token_budget > 0))
);


--
-- Name: COLUMN agent_runs.token_budget; Type: COMMENT; Schema: brain_core; Owner: -
--

COMMENT ON COLUMN brain_core.agent_runs.token_budget IS 'Maximum cumulative model tokens for the run; NULL means explicitly unlimited.';


--
-- Name: attachments; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.attachments (
    id text NOT NULL,
    schema_version integer NOT NULL,
    purpose text NOT NULL,
    media_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 text NOT NULL,
    storage_key text NOT NULL,
    original_filename text,
    duration_ms integer,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id text NOT NULL,
    CONSTRAINT attachments_purpose_check CHECK ((purpose = ANY (ARRAY['inbound'::text, 'prepared'::text, 'outbound'::text]))),
    CONSTRAINT attachments_size_bytes_check CHECK ((size_bytes >= 0))
);


--
-- Name: conversation_preferences; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.conversation_preferences (
    conversation_id text NOT NULL,
    thread_root_external_event_id text,
    voice_replies_enabled boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id text NOT NULL,
    session_context_mode text,
    session_history_limit integer,
    CONSTRAINT conversation_preferences_session_context_mode_check CHECK (((session_context_mode IS NULL) OR (session_context_mode = 'persistent'::text))),
    CONSTRAINT conversation_preferences_session_history_limit_check CHECK (((session_history_limit IS NULL) OR ((session_history_limit >= 0) AND (session_history_limit <= 100))))
);


--
-- Name: delegation_grants; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.delegation_grants (
    id text NOT NULL,
    parent_run_id text NOT NULL,
    workspace_id text NOT NULL,
    child_agent_id text NOT NULL,
    allowed_tools text[] NOT NULL,
    writable_paths text[] NOT NULL,
    timeout_seconds integer NOT NULL,
    token_budget integer,
    expires_at timestamp with time zone NOT NULL,
    readable_paths text[] DEFAULT ARRAY[]::text[] NOT NULL,
    CONSTRAINT delegation_grants_timeout_check CHECK ((timeout_seconds > 0)),
    CONSTRAINT delegation_grants_token_budget_check CHECK ((token_budget > 0))
);


--
-- Name: COLUMN delegation_grants.token_budget; Type: COMMENT; Schema: brain_core; Owner: -
--

COMMENT ON COLUMN brain_core.delegation_grants.token_budget IS 'Maximum cumulative model tokens delegated to the child; NULL means explicitly unlimited.';


--
-- Name: delivery_attempts; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.delivery_attempts (
    id text NOT NULL,
    outbound_message_id text NOT NULL,
    transport text NOT NULL,
    external_event_id text,
    status text NOT NULL,
    error jsonb,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id text NOT NULL
);


--
-- Name: idempotency_records; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.idempotency_records (
    idempotency_key text NOT NULL,
    scope text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id text NOT NULL
);


--
-- Name: inbound_message_attachments; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.inbound_message_attachments (
    inbound_message_id text NOT NULL,
    attachment_id text NOT NULL
);


--
-- Name: inbound_messages; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.inbound_messages (
    id text NOT NULL,
    schema_version integer NOT NULL,
    trace_id text NOT NULL,
    transport text NOT NULL,
    external_event_id text NOT NULL,
    conversation_id text NOT NULL,
    sender_id text NOT NULL,
    received_at timestamp with time zone NOT NULL,
    kind text NOT NULL,
    text_content text,
    reply_to_external_event_id text,
    thread_root_external_event_id text,
    replaces_external_event_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id text NOT NULL,
    agent_id text DEFAULT 'brain'::text NOT NULL,
    CONSTRAINT inbound_messages_agent_id_check CHECK ((agent_id ~ '^[a-z][a-z0-9-]{0,63}$'::text))
);


--
-- Name: outbound_message_files; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.outbound_message_files (
    outbound_message_id text NOT NULL,
    attachment_id text NOT NULL
);


--
-- Name: outbound_message_images; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.outbound_message_images (
    outbound_message_id text NOT NULL,
    attachment_id text NOT NULL
);


--
-- Name: outbound_messages; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.outbound_messages (
    id text NOT NULL,
    schema_version integer NOT NULL,
    trace_id text NOT NULL,
    conversation_id text NOT NULL,
    text_content text,
    audio_attachment_id text,
    reply_to_external_event_id text,
    thread_root_external_event_id text,
    urgency text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    thread_anchor_text text,
    workspace_id text NOT NULL
);


--
-- Name: retention_tombstones; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.retention_tombstones (
    id text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    status text NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    workspace_id text NOT NULL,
    CONSTRAINT retention_tombstones_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text]))),
    CONSTRAINT retention_tombstones_target_type_check CHECK ((target_type = ANY (ARRAY['inbound_message'::text, 'attachment'::text, 'pi_session'::text, 'outbound_message'::text, 'execution_content'::text])))
);


--
-- Name: root_run_admissions; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.root_run_admissions (
    root_run_id text NOT NULL,
    root_job_id text NOT NULL,
    workspace_id text NOT NULL,
    lease_owner text NOT NULL,
    acquired_at timestamp with time zone NOT NULL,
    heartbeat_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    state text NOT NULL,
    terminal_reason text,
    released_at timestamp with time zone,
    CONSTRAINT root_run_admissions_expiry_check CHECK ((expires_at > heartbeat_at)),
    CONSTRAINT root_run_admissions_heartbeat_check CHECK ((heartbeat_at >= acquired_at)),
    CONSTRAINT root_run_admissions_lease_owner_check CHECK ((length(lease_owner) > 0)),
    CONSTRAINT root_run_admissions_release_check CHECK ((((state = ANY (ARRAY['active'::text, 'releasing'::text])) AND (released_at IS NULL)) OR ((state = 'released'::text) AND (released_at IS NOT NULL)))),
    CONSTRAINT root_run_admissions_state_check CHECK ((state = ANY (ARRAY['active'::text, 'releasing'::text, 'released'::text])))
);


--
-- Name: scheduled_executions; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.scheduled_executions (
    id text NOT NULL,
    schema_version integer NOT NULL,
    schedule_id text NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    status text NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    session_id text,
    result_fingerprint text,
    error jsonb,
    created_at timestamp with time zone NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    workspace_id text NOT NULL
);


--
-- Name: scheduled_jobs; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.scheduled_jobs (
    id text NOT NULL,
    schema_version integer NOT NULL,
    name text NOT NULL,
    instruction text NOT NULL,
    schedule jsonb NOT NULL,
    enabled boolean NOT NULL,
    session_policy jsonb NOT NULL,
    notification_policy text NOT NULL,
    overlap_policy text NOT NULL,
    missed_run_policy text NOT NULL,
    timeout_seconds integer NOT NULL,
    next_run_at timestamp with time zone,
    last_run_at timestamp with time zone,
    version integer NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    workspace_id text NOT NULL,
    destination_conversation_id text,
    agent_id text DEFAULT 'brain'::text NOT NULL
);


--
-- Name: schema_metadata; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.schema_metadata (
    singleton boolean DEFAULT true NOT NULL,
    migration_number integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT schema_metadata_migration_number_check CHECK ((migration_number > 0)),
    CONSTRAINT schema_metadata_singleton_check CHECK (singleton)
);


--
-- Name: session_bindings; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.session_bindings (
    id text NOT NULL,
    conversation_id text,
    thread_root_external_event_id text,
    schedule_id text,
    active_session_id text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id text NOT NULL,
    agent_id text DEFAULT 'brain'::text NOT NULL,
    CONSTRAINT session_bindings_agent_id_check CHECK ((agent_id ~ '^[a-z][a-z0-9-]{0,63}$'::text))
);


--
-- Name: sessions; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.sessions (
    id text NOT NULL,
    label text,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    last_active_at timestamp with time zone NOT NULL,
    idle_expires_at timestamp with time zone NOT NULL,
    absolute_expires_at timestamp with time zone NOT NULL,
    pi_session_key text NOT NULL,
    source_type text NOT NULL,
    source_conversation_id text,
    source_thread_root_id text,
    source_schedule_id text,
    version integer DEFAULT 1 NOT NULL,
    workspace_id text NOT NULL,
    CONSTRAINT sessions_source_type_check CHECK ((source_type = ANY (ARRAY['default-room'::text, 'thread'::text, 'scheduled'::text]))),
    CONSTRAINT sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'idle'::text, 'closed'::text, 'expired'::text, 'purged'::text])))
);


--
-- Name: thread_agent_selections; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.thread_agent_selections (
    workspace_id text NOT NULL,
    conversation_id text NOT NULL,
    thread_root_external_event_id text NOT NULL,
    agent_id text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT thread_agent_selections_agent_id_check CHECK ((agent_id ~ '^[a-z][a-z0-9-]{0,63}$'::text))
);


--
-- Name: workspace_plugin_bindings; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.workspace_plugin_bindings (
    workspace_id text NOT NULL,
    plugin_id text NOT NULL,
    plugin_version text NOT NULL,
    enabled_agents text[] NOT NULL,
    configuration jsonb DEFAULT '{}'::jsonb NOT NULL,
    credential_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_plugin_bindings_agents_check CHECK (brain_core.valid_agent_identifiers(enabled_agents)),
    CONSTRAINT workspace_plugin_bindings_plugin_id_check CHECK ((plugin_id ~ '^[a-z][a-z0-9-]{0,63}$'::text))
);


--
-- Name: workspace_room_bindings; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.workspace_room_bindings (
    id text NOT NULL,
    workspace_id text NOT NULL,
    room_id text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT workspace_room_bindings_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: workspace_write_leases; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.workspace_write_leases (
    workspace_id text NOT NULL,
    id text NOT NULL,
    owner_run_id text NOT NULL,
    acquired_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: workspaces; Type: TABLE; Schema: brain_core; Owner: -
--

CREATE TABLE brain_core.workspaces (
    id text NOT NULL,
    template_id text NOT NULL,
    template_version text NOT NULL,
    configuration jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    origin text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone,
    archived_at timestamp with time zone,
    closed_at timestamp with time zone,
    default_agent text DEFAULT 'brain'::text NOT NULL,
    CONSTRAINT workspaces_default_agent_check CHECK ((default_agent ~ '^[a-z][a-z0-9-]{0,63}$'::text)),
    CONSTRAINT workspaces_status_check CHECK ((status = ANY (ARRAY['pending_invite'::text, 'configuring'::text, 'provisioning'::text, 'active'::text, 'archived'::text, 'closed'::text, 'failed'::text])))
);


--
-- Name: jobs; Type: TABLE; Schema: brain_jobs; Owner: -
--

CREATE TABLE brain_jobs.jobs (
    id text NOT NULL,
    schema_version integer NOT NULL,
    type text NOT NULL,
    payload jsonb NOT NULL,
    priority integer NOT NULL,
    status text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone NOT NULL,
    lease_owner text,
    lease_expires_at timestamp with time zone,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id text NOT NULL
);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: brain_audit; Owner: -
--

ALTER TABLE ONLY brain_audit.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: action_approval_policies action_approval_policies_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.action_approval_policies
    ADD CONSTRAINT action_approval_policies_pkey PRIMARY KEY (workspace_id, plugin_id, operation_id);


--
-- Name: action_proposals action_proposals_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.action_proposals
    ADD CONSTRAINT action_proposals_pkey PRIMARY KEY (id);


--
-- Name: agent_artifacts agent_artifacts_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.agent_artifacts
    ADD CONSTRAINT agent_artifacts_pkey PRIMARY KEY (id);


--
-- Name: agent_runs agent_runs_delegation_grant_unique; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.agent_runs
    ADD CONSTRAINT agent_runs_delegation_grant_unique UNIQUE (delegation_grant_id);


--
-- Name: agent_runs agent_runs_id_root_run_unique; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.agent_runs
    ADD CONSTRAINT agent_runs_id_root_run_unique UNIQUE (id, root_run_id);


--
-- Name: agent_runs agent_runs_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: attachments attachments_storage_key_key; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.attachments
    ADD CONSTRAINT attachments_storage_key_key UNIQUE (storage_key);


--
-- Name: conversation_preferences conversation_preferences_conversation_id_thread_root_extern_key; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.conversation_preferences
    ADD CONSTRAINT conversation_preferences_conversation_id_thread_root_extern_key UNIQUE NULLS NOT DISTINCT (conversation_id, thread_root_external_event_id);


--
-- Name: delegation_grants delegation_grants_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.delegation_grants
    ADD CONSTRAINT delegation_grants_pkey PRIMARY KEY (id);


--
-- Name: delivery_attempts delivery_attempts_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.delivery_attempts
    ADD CONSTRAINT delivery_attempts_pkey PRIMARY KEY (id);


--
-- Name: idempotency_records idempotency_records_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.idempotency_records
    ADD CONSTRAINT idempotency_records_pkey PRIMARY KEY (idempotency_key);


--
-- Name: inbound_message_attachments inbound_message_attachments_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.inbound_message_attachments
    ADD CONSTRAINT inbound_message_attachments_pkey PRIMARY KEY (inbound_message_id, attachment_id);


--
-- Name: inbound_messages inbound_messages_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.inbound_messages
    ADD CONSTRAINT inbound_messages_pkey PRIMARY KEY (id);


--
-- Name: inbound_messages inbound_messages_transport_external_event_id_key; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.inbound_messages
    ADD CONSTRAINT inbound_messages_transport_external_event_id_key UNIQUE (transport, external_event_id);


--
-- Name: outbound_message_files outbound_message_files_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.outbound_message_files
    ADD CONSTRAINT outbound_message_files_pkey PRIMARY KEY (outbound_message_id, attachment_id);


--
-- Name: outbound_message_images outbound_message_images_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.outbound_message_images
    ADD CONSTRAINT outbound_message_images_pkey PRIMARY KEY (outbound_message_id, attachment_id);


--
-- Name: outbound_messages outbound_messages_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.outbound_messages
    ADD CONSTRAINT outbound_messages_pkey PRIMARY KEY (id);


--
-- Name: outbound_messages outbound_messages_workspace_idempotency_key; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.outbound_messages
    ADD CONSTRAINT outbound_messages_workspace_idempotency_key UNIQUE (workspace_id, idempotency_key);


--
-- Name: retention_tombstones retention_tombstones_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.retention_tombstones
    ADD CONSTRAINT retention_tombstones_pkey PRIMARY KEY (id);


--
-- Name: root_run_admissions root_run_admissions_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.root_run_admissions
    ADD CONSTRAINT root_run_admissions_pkey PRIMARY KEY (root_run_id);


--
-- Name: root_run_admissions root_run_admissions_root_job_id_key; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.root_run_admissions
    ADD CONSTRAINT root_run_admissions_root_job_id_key UNIQUE (root_job_id);


--
-- Name: scheduled_executions scheduled_executions_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.scheduled_executions
    ADD CONSTRAINT scheduled_executions_pkey PRIMARY KEY (id);


--
-- Name: scheduled_executions scheduled_executions_schedule_id_scheduled_for_key; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.scheduled_executions
    ADD CONSTRAINT scheduled_executions_schedule_id_scheduled_for_key UNIQUE (schedule_id, scheduled_for);


--
-- Name: scheduled_jobs scheduled_jobs_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.scheduled_jobs
    ADD CONSTRAINT scheduled_jobs_pkey PRIMARY KEY (id);


--
-- Name: schema_metadata schema_metadata_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.schema_metadata
    ADD CONSTRAINT schema_metadata_pkey PRIMARY KEY (singleton);


--
-- Name: session_bindings session_bindings_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.session_bindings
    ADD CONSTRAINT session_bindings_pkey PRIMARY KEY (id);


--
-- Name: session_bindings session_bindings_workspace_agent_binding_key; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.session_bindings
    ADD CONSTRAINT session_bindings_workspace_agent_binding_key UNIQUE NULLS NOT DISTINCT (workspace_id, agent_id, conversation_id, thread_root_external_event_id, schedule_id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: thread_agent_selections thread_agent_selections_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.thread_agent_selections
    ADD CONSTRAINT thread_agent_selections_pkey PRIMARY KEY (workspace_id, conversation_id, thread_root_external_event_id);


--
-- Name: workspace_plugin_bindings workspace_plugin_bindings_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.workspace_plugin_bindings
    ADD CONSTRAINT workspace_plugin_bindings_pkey PRIMARY KEY (workspace_id, plugin_id);


--
-- Name: workspace_room_bindings workspace_room_bindings_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.workspace_room_bindings
    ADD CONSTRAINT workspace_room_bindings_pkey PRIMARY KEY (id);


--
-- Name: workspace_room_bindings workspace_room_bindings_room_id_key; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.workspace_room_bindings
    ADD CONSTRAINT workspace_room_bindings_room_id_key UNIQUE (room_id);


--
-- Name: workspace_write_leases workspace_write_leases_id_key; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.workspace_write_leases
    ADD CONSTRAINT workspace_write_leases_id_key UNIQUE (id);


--
-- Name: workspace_write_leases workspace_write_leases_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.workspace_write_leases
    ADD CONSTRAINT workspace_write_leases_pkey PRIMARY KEY (workspace_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: brain_jobs; Owner: -
--

ALTER TABLE ONLY brain_jobs.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_workspace_idempotency_key; Type: CONSTRAINT; Schema: brain_jobs; Owner: -
--

ALTER TABLE ONLY brain_jobs.jobs
    ADD CONSTRAINT jobs_workspace_idempotency_key UNIQUE (workspace_id, idempotency_key);


--
-- Name: action_approval_policies_workspace_plugin_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX action_approval_policies_workspace_plugin_idx ON brain_core.action_approval_policies USING btree (workspace_id, plugin_id);


--
-- Name: action_proposals_approval_prompt_outbound_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE UNIQUE INDEX action_proposals_approval_prompt_outbound_idx ON brain_core.action_proposals USING btree (approval_prompt_outbound_id) WHERE (approval_prompt_outbound_id IS NOT NULL);


--
-- Name: action_proposals_external_decision_event_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE UNIQUE INDEX action_proposals_external_decision_event_idx ON brain_core.action_proposals USING btree (decision_external_event_id) WHERE (decision_external_event_id IS NOT NULL);


--
-- Name: action_proposals_status_expiry_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX action_proposals_status_expiry_idx ON brain_core.action_proposals USING btree (status, expires_at);


--
-- Name: action_proposals_workspace_run_idempotency_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE UNIQUE INDEX action_proposals_workspace_run_idempotency_idx ON brain_core.action_proposals USING btree (workspace_id, run_id, idempotency_key);


--
-- Name: action_proposals_workspace_run_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX action_proposals_workspace_run_idx ON brain_core.action_proposals USING btree (workspace_id, run_id);


--
-- Name: agent_artifacts_run_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX agent_artifacts_run_idx ON brain_core.agent_artifacts USING btree (producing_run_id);


--
-- Name: agent_runs_parent_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX agent_runs_parent_idx ON brain_core.agent_runs USING btree (parent_run_id);


--
-- Name: agent_runs_root_status_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX agent_runs_root_status_idx ON brain_core.agent_runs USING btree (root_run_id, status);


--
-- Name: attachments_workspace_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX attachments_workspace_idx ON brain_core.attachments USING btree (workspace_id, created_at DESC);


--
-- Name: conversation_preferences_workspace_scope_key; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE UNIQUE INDEX conversation_preferences_workspace_scope_key ON brain_core.conversation_preferences USING btree (workspace_id, conversation_id, thread_root_external_event_id) NULLS NOT DISTINCT;


--
-- Name: delivery_attempts_matrix_external_event_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX delivery_attempts_matrix_external_event_idx ON brain_core.delivery_attempts USING btree (external_event_id) WHERE ((transport = 'matrix'::text) AND (status = 'delivered'::text) AND (external_event_id IS NOT NULL));


--
-- Name: inbound_messages_workspace_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX inbound_messages_workspace_idx ON brain_core.inbound_messages USING btree (workspace_id, created_at DESC);


--
-- Name: outbound_message_files_attachment_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX outbound_message_files_attachment_idx ON brain_core.outbound_message_files USING btree (attachment_id);


--
-- Name: outbound_messages_workspace_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX outbound_messages_workspace_idx ON brain_core.outbound_messages USING btree (workspace_id, created_at DESC);


--
-- Name: root_run_admissions_state_expiry_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX root_run_admissions_state_expiry_idx ON brain_core.root_run_admissions USING btree (state, expires_at);


--
-- Name: root_run_admissions_workspace_state_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX root_run_admissions_workspace_state_idx ON brain_core.root_run_admissions USING btree (workspace_id, state);


--
-- Name: scheduled_jobs_workspace_destination_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX scheduled_jobs_workspace_destination_idx ON brain_core.scheduled_jobs USING btree (workspace_id, destination_conversation_id) WHERE (deleted_at IS NULL);


--
-- Name: scheduled_jobs_workspace_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX scheduled_jobs_workspace_idx ON brain_core.scheduled_jobs USING btree (workspace_id, updated_at DESC);


--
-- Name: sessions_workspace_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX sessions_workspace_idx ON brain_core.sessions USING btree (workspace_id, last_active_at DESC);


--
-- Name: workspace_plugin_bindings_workspace_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX workspace_plugin_bindings_workspace_idx ON brain_core.workspace_plugin_bindings USING btree (workspace_id);


--
-- Name: workspace_write_leases_expiry_idx; Type: INDEX; Schema: brain_core; Owner: -
--

CREATE INDEX workspace_write_leases_expiry_idx ON brain_core.workspace_write_leases USING btree (expires_at);


--
-- Name: jobs_claim_idx; Type: INDEX; Schema: brain_jobs; Owner: -
--

CREATE INDEX jobs_claim_idx ON brain_jobs.jobs USING btree (status, priority DESC, available_at);


--
-- Name: jobs_workspace_claim_idx; Type: INDEX; Schema: brain_jobs; Owner: -
--

CREATE INDEX jobs_workspace_claim_idx ON brain_jobs.jobs USING btree (workspace_id, status, priority DESC, available_at);


--
-- Name: audit_events audit_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_audit; Owner: -
--

ALTER TABLE ONLY brain_audit.audit_events
    ADD CONSTRAINT audit_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: action_approval_policies action_approval_policies_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.action_approval_policies
    ADD CONSTRAINT action_approval_policies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: action_proposals action_proposals_approval_prompt_outbound_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.action_proposals
    ADD CONSTRAINT action_proposals_approval_prompt_outbound_id_fkey FOREIGN KEY (approval_prompt_outbound_id) REFERENCES brain_core.outbound_messages(id) ON DELETE SET NULL;


--
-- Name: action_proposals action_proposals_run_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.action_proposals
    ADD CONSTRAINT action_proposals_run_id_fkey FOREIGN KEY (run_id) REFERENCES brain_core.agent_runs(id) ON DELETE RESTRICT;


--
-- Name: action_proposals action_proposals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.action_proposals
    ADD CONSTRAINT action_proposals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: agent_artifacts agent_artifacts_parent_run_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.agent_artifacts
    ADD CONSTRAINT agent_artifacts_parent_run_id_fkey FOREIGN KEY (parent_run_id) REFERENCES brain_core.agent_runs(id) ON DELETE RESTRICT;


--
-- Name: agent_artifacts agent_artifacts_producing_run_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.agent_artifacts
    ADD CONSTRAINT agent_artifacts_producing_run_id_fkey FOREIGN KEY (producing_run_id) REFERENCES brain_core.agent_runs(id) ON DELETE RESTRICT;


--
-- Name: agent_artifacts agent_artifacts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.agent_artifacts
    ADD CONSTRAINT agent_artifacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: agent_runs agent_runs_delegation_grant_fk; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.agent_runs
    ADD CONSTRAINT agent_runs_delegation_grant_fk FOREIGN KEY (delegation_grant_id) REFERENCES brain_core.delegation_grants(id) ON DELETE RESTRICT;


--
-- Name: agent_runs agent_runs_parent_root_fk; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.agent_runs
    ADD CONSTRAINT agent_runs_parent_root_fk FOREIGN KEY (parent_run_id, root_run_id) REFERENCES brain_core.agent_runs(id, root_run_id) ON DELETE RESTRICT;


--
-- Name: agent_runs agent_runs_parent_run_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.agent_runs
    ADD CONSTRAINT agent_runs_parent_run_id_fkey FOREIGN KEY (parent_run_id) REFERENCES brain_core.agent_runs(id) ON DELETE RESTRICT;


--
-- Name: agent_runs agent_runs_root_run_fk; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.agent_runs
    ADD CONSTRAINT agent_runs_root_run_fk FOREIGN KEY (root_run_id) REFERENCES brain_core.agent_runs(id) ON DELETE RESTRICT;


--
-- Name: agent_runs agent_runs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.agent_runs
    ADD CONSTRAINT agent_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: attachments attachments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.attachments
    ADD CONSTRAINT attachments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: conversation_preferences conversation_preferences_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.conversation_preferences
    ADD CONSTRAINT conversation_preferences_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: delegation_grants delegation_grants_parent_run_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.delegation_grants
    ADD CONSTRAINT delegation_grants_parent_run_id_fkey FOREIGN KEY (parent_run_id) REFERENCES brain_core.agent_runs(id) ON DELETE RESTRICT;


--
-- Name: delegation_grants delegation_grants_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.delegation_grants
    ADD CONSTRAINT delegation_grants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: delivery_attempts delivery_attempts_outbound_message_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.delivery_attempts
    ADD CONSTRAINT delivery_attempts_outbound_message_id_fkey FOREIGN KEY (outbound_message_id) REFERENCES brain_core.outbound_messages(id) ON DELETE CASCADE;


--
-- Name: delivery_attempts delivery_attempts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.delivery_attempts
    ADD CONSTRAINT delivery_attempts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: idempotency_records idempotency_records_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.idempotency_records
    ADD CONSTRAINT idempotency_records_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: inbound_message_attachments inbound_message_attachments_attachment_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.inbound_message_attachments
    ADD CONSTRAINT inbound_message_attachments_attachment_id_fkey FOREIGN KEY (attachment_id) REFERENCES brain_core.attachments(id) ON DELETE RESTRICT;


--
-- Name: inbound_message_attachments inbound_message_attachments_inbound_message_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.inbound_message_attachments
    ADD CONSTRAINT inbound_message_attachments_inbound_message_id_fkey FOREIGN KEY (inbound_message_id) REFERENCES brain_core.inbound_messages(id) ON DELETE CASCADE;


--
-- Name: inbound_messages inbound_messages_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.inbound_messages
    ADD CONSTRAINT inbound_messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: outbound_message_files outbound_message_files_attachment_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.outbound_message_files
    ADD CONSTRAINT outbound_message_files_attachment_id_fkey FOREIGN KEY (attachment_id) REFERENCES brain_core.attachments(id) ON DELETE RESTRICT;


--
-- Name: outbound_message_files outbound_message_files_outbound_message_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.outbound_message_files
    ADD CONSTRAINT outbound_message_files_outbound_message_id_fkey FOREIGN KEY (outbound_message_id) REFERENCES brain_core.outbound_messages(id) ON DELETE CASCADE;


--
-- Name: outbound_message_images outbound_message_images_attachment_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.outbound_message_images
    ADD CONSTRAINT outbound_message_images_attachment_id_fkey FOREIGN KEY (attachment_id) REFERENCES brain_core.attachments(id) ON DELETE RESTRICT;


--
-- Name: outbound_message_images outbound_message_images_outbound_message_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.outbound_message_images
    ADD CONSTRAINT outbound_message_images_outbound_message_id_fkey FOREIGN KEY (outbound_message_id) REFERENCES brain_core.outbound_messages(id) ON DELETE CASCADE;


--
-- Name: outbound_messages outbound_messages_audio_attachment_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.outbound_messages
    ADD CONSTRAINT outbound_messages_audio_attachment_id_fkey FOREIGN KEY (audio_attachment_id) REFERENCES brain_core.attachments(id) ON DELETE RESTRICT;


--
-- Name: outbound_messages outbound_messages_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.outbound_messages
    ADD CONSTRAINT outbound_messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: retention_tombstones retention_tombstones_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.retention_tombstones
    ADD CONSTRAINT retention_tombstones_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: root_run_admissions root_run_admissions_root_job_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.root_run_admissions
    ADD CONSTRAINT root_run_admissions_root_job_id_fkey FOREIGN KEY (root_job_id) REFERENCES brain_jobs.jobs(id) ON DELETE RESTRICT;


--
-- Name: root_run_admissions root_run_admissions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.root_run_admissions
    ADD CONSTRAINT root_run_admissions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: scheduled_executions scheduled_executions_schedule_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.scheduled_executions
    ADD CONSTRAINT scheduled_executions_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES brain_core.scheduled_jobs(id) ON DELETE RESTRICT;


--
-- Name: scheduled_executions scheduled_executions_session_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.scheduled_executions
    ADD CONSTRAINT scheduled_executions_session_id_fkey FOREIGN KEY (session_id) REFERENCES brain_core.sessions(id) ON DELETE SET NULL;


--
-- Name: scheduled_executions scheduled_executions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.scheduled_executions
    ADD CONSTRAINT scheduled_executions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: scheduled_jobs scheduled_jobs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.scheduled_jobs
    ADD CONSTRAINT scheduled_jobs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: session_bindings session_bindings_active_session_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.session_bindings
    ADD CONSTRAINT session_bindings_active_session_id_fkey FOREIGN KEY (active_session_id) REFERENCES brain_core.sessions(id) ON DELETE RESTRICT;


--
-- Name: session_bindings session_bindings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.session_bindings
    ADD CONSTRAINT session_bindings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: sessions sessions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.sessions
    ADD CONSTRAINT sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: thread_agent_selections thread_agent_selections_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.thread_agent_selections
    ADD CONSTRAINT thread_agent_selections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: workspace_plugin_bindings workspace_plugin_bindings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.workspace_plugin_bindings
    ADD CONSTRAINT workspace_plugin_bindings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: workspace_room_bindings workspace_room_bindings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.workspace_room_bindings
    ADD CONSTRAINT workspace_room_bindings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: workspace_write_leases workspace_write_leases_owner_run_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.workspace_write_leases
    ADD CONSTRAINT workspace_write_leases_owner_run_id_fkey FOREIGN KEY (owner_run_id) REFERENCES brain_core.agent_runs(id) ON DELETE RESTRICT;


--
-- Name: workspace_write_leases workspace_write_leases_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_core; Owner: -
--

ALTER TABLE ONLY brain_core.workspace_write_leases
    ADD CONSTRAINT workspace_write_leases_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


--
-- Name: jobs jobs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: brain_jobs; Owner: -
--

ALTER TABLE ONLY brain_jobs.jobs
    ADD CONSTRAINT jobs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES brain_core.workspaces(id) ON DELETE RESTRICT;


INSERT INTO brain_core.schema_metadata (singleton, migration_number)
VALUES (true, 1);
