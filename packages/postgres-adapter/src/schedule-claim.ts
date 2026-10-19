import { claimDueSchedules, type ScheduleClaimPort } from "@second-brain/application";
import type { ScheduledExecutionV1 } from "@second-brain/contracts/schemas";
import type { IdGeneratorPort } from "@second-brain/domain";

import { PostgresJobQueue } from "./job-queue.js";
import {
  PostgresExecutionRepository,
  PostgresScheduleRepository
} from "./repositories/schedule-repository.js";
import { withTransaction, type PostgresTransactionSource } from "./transaction.js";

export interface PostgresScheduleClaimServiceOptions {
  db: PostgresTransactionSource;
  ids: IdGeneratorPort;
}

export class PostgresScheduleClaimService implements ScheduleClaimPort {
  private readonly db: PostgresTransactionSource;
  private readonly ids: IdGeneratorPort;

  constructor(options: PostgresScheduleClaimServiceOptions) {
    this.db = options.db;
    this.ids = options.ids;
  }

  async claimDue(input: { now: Date; limit: number }): Promise<ScheduledExecutionV1[]> {
    return withTransaction(this.db, (client) => {
      const schedules = new PostgresScheduleRepository({ db: client });
      const executions = new PostgresExecutionRepository({ db: client });
      const jobs = new PostgresJobQueue({ db: client });
      return claimDueSchedules({ ...input, schedules, executions, jobs, ids: this.ids });
    });
  }
}
