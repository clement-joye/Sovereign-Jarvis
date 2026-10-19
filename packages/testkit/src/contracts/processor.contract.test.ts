import { DeterministicMediaProcessor, DeterministicPiRunner } from "../fakes/fakes.js";
import { mediaProcessorContract, piRunnerContract } from "./processor.contract.js";

piRunnerContract({
  name: "deterministic fake",
  create: () => new DeterministicPiRunner()
});

mediaProcessorContract({
  name: "deterministic fake",
  create: () => new DeterministicMediaProcessor()
});
