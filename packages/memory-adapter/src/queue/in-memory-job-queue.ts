import type { JobQueuePort, RootRunAdmissionSnapshot } from "@second-brain/application";
import type { InternalJobV1 } from "@second-brain/contracts";
import { requireWorkspaceId } from "@second-brain/domain";

import {
  isAdmissionRenewable,
  isJobClaimable,
  isLeaseRenewable,
  rootRunIdForJob,
  startsRootAdmission,
  type RootAdmissionRecord
} from "./in-memory-job-queue-policy.js";

export class InMemoryJobQueue implements JobQueuePort {
  private readonly jobs = new Map<string, InternalJobV1>();
  private readonly admissions = new Map<string, RootAdmissionRecord>();

  async enqueue(job: InternalJobV1): Promise<InternalJobV1> {
    const existing = [...this.jobs.values()].find(
      (candidate) =>
        candidate.idempotencyKey === job.idempotencyKey &&
        requireWorkspaceId(candidate.workspaceId, "Stored job") ===
          requireWorkspaceId(job.workspaceId, "Job enqueue")
    );
    if (existing) {
      return existing;
    }

    this.jobs.set(job.id, job);
    return job;
  }

  async claim(input: {
    workerId: string;
    limit: number;
    now: Date;
    leaseMs: number;
    jobTypes?: InternalJobV1["type"][];
    rootAdmission?: { limit: number; leaseMs: number };
  }): Promise<InternalJobV1[]> {
    const nowIso = input.now.toISOString();
    for (const [rootRunId, admission] of this.admissions) {
      if (admission.expiresAt <= nowIso) this.admissions.delete(rootRunId);
    }
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
    const slots = {
      remaining: input.rootAdmission
        ? Math.max(0, input.rootAdmission.limit - this.admissions.size)
        : 0
    };
    const claimContext = { criteria: input, nowIso, admissions: this.admissions, slots };
    const claimable = [...this.jobs.values()]
      .sort((a, b) => b.priority - a.priority || a.availableAt.localeCompare(b.availableAt))
      .filter((job) => isJobClaimable(job, claimContext))
      .slice(0, input.limit);

    const claimed = claimable.map((job) => ({
      ...job,
      status: "leased" as const,
      leaseOwner: input.workerId,
      leaseExpiresAt
    }));

    for (const job of claimed) {
      this.jobs.set(job.id, job);
      if (input.rootAdmission && startsRootAdmission(job)) {
        this.admissions.set(job.id, {
          rootJobId: job.id,
          workspaceId: requireWorkspaceId(job.workspaceId, "Root admission"),
          leaseOwner: input.workerId,
          acquiredAt: nowIso,
          heartbeatAt: nowIso,
          expiresAt: new Date(input.now.getTime() + input.rootAdmission.leaseMs).toISOString()
        });
      }
    }

    return claimed;
  }

  async renew(input: {
    jobId: string;
    leaseOwner: string;
    now: Date;
    leaseMs: number;
    admissionLeaseMs?: number;
  }): Promise<boolean> {
    const job = this.jobs.get(input.jobId);
    if (!isLeaseRenewable(job, input)) return false;
    const rootRunId = rootRunIdForJob(job);
    const admission = this.admissions.get(rootRunId);
    if (!isAdmissionRenewable(job, admission, input)) return false;
    this.jobs.set(job.id, {
      ...job,
      leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs).toISOString()
    });
    if (admission && input.admissionLeaseMs !== undefined) {
      this.admissions.set(rootRunId, {
        ...admission,
        heartbeatAt: input.now.toISOString(),
        expiresAt: new Date(input.now.getTime() + input.admissionLeaseMs).toISOString()
      });
    }
    return true;
  }

  async cancelRootRun(input: { rootRunId: string; now: Date; reason: string }): Promise<number> {
    const root = this.jobs.get(input.rootRunId);
    if (
      input.reason !== "agent_tree_cancelled" &&
      root?.status !== "pending" &&
      root?.status !== "retry_wait"
    )
      return 0;
    let cancelled = 0;
    for (const [id, job] of this.jobs) {
      const belongsToRoot =
        id === input.rootRunId ||
        (job.type === "run_agent" && job.payload.rootRunId === input.rootRunId);
      if (!belongsToRoot || ["completed", "dead_letter", "cancelled"].includes(job.status))
        continue;
      const updated: InternalJobV1 = {
        ...job,
        status: "cancelled",
        payload: { ...job.payload, cancellationReason: input.reason }
      };
      delete updated.leaseOwner;
      delete updated.leaseExpiresAt;
      this.jobs.set(id, updated);
      cancelled += 1;
    }
    this.admissions.delete(input.rootRunId);
    return cancelled;
  }

  async hasLiveRootAdmission(rootRunId: string, now: Date): Promise<boolean> {
    const admission = this.admissions.get(rootRunId);
    return admission !== undefined && admission.expiresAt > now.toISOString();
  }

  async complete(input: { jobId: string; leaseOwner: string }): Promise<void> {
    const job = this.jobs.get(input.jobId);

    if (!job) {
      throw new Error(`Unknown job: ${input.jobId}`);
    }

    if (job.leaseOwner !== input.leaseOwner) {
      throw new Error("Only the active lease owner can complete a job.");
    }

    this.jobs.set(job.id, { ...job, status: "completed" });
    this.releaseTerminalTree(rootRunIdForJob(job));
  }

  async fail(input: {
    jobId: string;
    leaseOwner: string;
    now: Date;
    retryable: boolean;
    reason: string;
    retryDelayMs?: number;
    maxAttempts: number;
  }): Promise<InternalJobV1> {
    const job = this.jobs.get(input.jobId);

    if (!job) {
      throw new Error(`Unknown job: ${input.jobId}`);
    }

    if (job.leaseOwner !== input.leaseOwner) {
      throw new Error("Only the active lease owner can fail a job.");
    }

    const attempts = job.attempts + 1;
    const status =
      input.retryable && attempts < input.maxAttempts
        ? ("retry_wait" as const)
        : ("dead_letter" as const);
    const jobWithoutLease: InternalJobV1 = { ...job };
    delete jobWithoutLease.leaseOwner;
    delete jobWithoutLease.leaseExpiresAt;
    const updated: InternalJobV1 = {
      ...jobWithoutLease,
      status,
      attempts,
      availableAt:
        status === "retry_wait"
          ? new Date(input.now.getTime() + (input.retryDelayMs ?? 0)).toISOString()
          : input.now.toISOString(),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      payload: { ...job.payload, lastError: input.reason }
    };
    this.jobs.set(job.id, updated);
    this.admissions.delete(job.id);
    this.releaseTerminalTree(rootRunIdForJob(job));
    return updated;
  }

  snapshot(): InternalJobV1[] {
    return [...this.jobs.values()];
  }

  async admissionSnapshot(limit: number, now = new Date()): Promise<RootRunAdmissionSnapshot> {
    const nowIso = now.toISOString();
    const waiting = [...this.jobs.values()]
      .filter(
        (job) =>
          (job.status === "pending" || job.status === "retry_wait") &&
          (job.type === "run_schedule" ||
            (job.type === "process_inbound" && job.payload.requiresRootAdmission !== false))
      )
      .sort(
        (left, right) =>
          left.availableAt.localeCompare(right.availableAt) || left.id.localeCompare(right.id)
      );
    const roots = [...this.admissions.entries()]
      .filter(([, admission]) => admission.expiresAt > nowIso)
      .map(([rootRunId, admission]) => ({
        rootRunId,
        ...admission,
        leaseAgeMs: Math.max(0, now.getTime() - Date.parse(admission.acquiredAt))
      }));
    const oldest = waiting[0];
    return {
      limit,
      activeRoots: roots.length,
      queueDepth: waiting.length,
      ...(oldest
        ? {
            oldestWaitingRoot: {
              jobId: oldest.id,
              availableAt: oldest.availableAt,
              waitMs: Math.max(0, now.getTime() - Date.parse(oldest.availableAt))
            }
          }
        : {}),
      waitingSchedules: waiting.filter((job) => job.type === "run_schedule").length,
      roots
    };
  }

  private releaseTerminalTree(rootRunId: string): void {
    const root = this.jobs.get(rootRunId);
    if (!root || !["completed", "dead_letter", "cancelled"].includes(root.status)) return;
    const hasActiveDescendant = [...this.jobs.values()].some(
      (job) =>
        job.type === "run_agent" &&
        job.payload.rootRunId === rootRunId &&
        !["completed", "dead_letter", "cancelled"].includes(job.status)
    );
    if (!hasActiveDescendant) this.admissions.delete(rootRunId);
  }
}
