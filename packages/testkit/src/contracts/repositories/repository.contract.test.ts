import {
  InMemoryExecutionRepository,
  InMemoryOutboundRepository,
  InMemoryScheduleRepository,
  InMemorySessionRepository
} from "../../fakes/fakes.js";
import {
  executionRepositoryContract,
  outboundRepositoryContract,
  scheduleRepositoryContract,
  sessionRepositoryContract
} from "./repository.contract.js";

sessionRepositoryContract({
  name: "in-memory",
  create: () => new InMemorySessionRepository()
});

scheduleRepositoryContract({
  name: "in-memory",
  create: () => new InMemoryScheduleRepository()
});

executionRepositoryContract({
  name: "in-memory",
  create: () => new InMemoryExecutionRepository()
});

outboundRepositoryContract({
  name: "in-memory",
  create: () => new InMemoryOutboundRepository()
});
