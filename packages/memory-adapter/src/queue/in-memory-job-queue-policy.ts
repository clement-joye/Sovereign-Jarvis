import type { InternalJobV1 } from "@second-brain/contracts";

export interface RootAdmissionRecord {
  rootJobId: string;
  workspaceId: string;
  leaseOwner: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

interface ClaimCriteria {
  jobTypes?: InternalJobV1["type"][];
  rootAdmission?: { limit: number; leaseMs: number };
}

interface RootSlotBudget {
  remaining: number;
}

interface JobClaimContext {
  criteria: ClaimCriteria;
  nowIso: string;
  admissions: ReadonlyMap<string, RootAdmissionRecord>;
  slots: RootSlotBudget;
}

interface RenewalCriteria {
  leaseOwner: string;
  now: Date;
  admissionLeaseMs?: number;
}

export function isJobClaimable(job: InternalJobV1, context: JobClaimContext): boolean {
  if (!isGenerallyClaimable(job, context.criteria.jobTypes, context.nowIso)) return false;
  if (!context.criteria.rootAdmission) return true;
  if (job.type === "run_agent") return context.admissions.has(rootRunIdForJob(job));
  if (!requiresRootAdmission(job)) return true;
  if (context.admissions.has(job.id)) return true;
  if (context.slots.remaining <= 0) return false;
  context.slots.remaining -= 1;
  return true;
}

export function isLeaseRenewable(
  job: InternalJobV1 | undefined,
  criteria: RenewalCriteria
): job is InternalJobV1 {
  return Boolean(
    job &&
      job.leaseOwner === criteria.leaseOwner &&
      (job.status === "leased" || job.status === "running") &&
      job.leaseExpiresAt &&
      job.leaseExpiresAt > criteria.now.toISOString()
  );
}

export function isAdmissionRenewable(
  job: InternalJobV1,
  admission: RootAdmissionRecord | undefined,
  criteria: RenewalCriteria
): boolean {
  if (criteria.admissionLeaseMs === undefined || !requiresRootAdmission(job)) return true;
  if (!admission || admission.expiresAt <= criteria.now.toISOString()) return false;
  return admission.rootJobId !== job.id || admission.leaseOwner === criteria.leaseOwner;
}

export function requiresRootAdmission(job: InternalJobV1): boolean {
  return (
    job.type === "run_schedule" ||
    job.type === "run_agent" ||
    (job.type === "process_inbound" && job.payload.requiresRootAdmission !== false)
  );
}

export function startsRootAdmission(job: InternalJobV1): boolean {
  return (
    job.type === "run_schedule" ||
    (job.type === "process_inbound" && job.payload.requiresRootAdmission !== false)
  );
}

export function rootRunIdForJob(job: InternalJobV1): string {
  return job.type === "run_agent" && typeof job.payload.rootRunId === "string"
    ? job.payload.rootRunId
    : job.id;
}

function isGenerallyClaimable(
  job: InternalJobV1,
  jobTypes: InternalJobV1["type"][] | undefined,
  nowIso: string
): boolean {
  if (jobTypes && !jobTypes.includes(job.type)) return false;
  if (job.status === "pending" || job.status === "retry_wait") {
    return job.availableAt <= nowIso;
  }
  return (
    (job.status === "leased" || job.status === "running") &&
    job.leaseExpiresAt !== undefined &&
    job.leaseExpiresAt <= nowIso
  );
}
