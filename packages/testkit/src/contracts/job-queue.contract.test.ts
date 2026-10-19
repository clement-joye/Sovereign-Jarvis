import { InMemoryJobQueue } from "../fakes/fakes.js";
import { jobQueueContract } from "./job-queue.contract.js";

jobQueueContract({
  name: "in-memory",
  create: () => new InMemoryJobQueue()
});
