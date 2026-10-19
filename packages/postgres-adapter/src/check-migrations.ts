import { accessSync } from "node:fs";
import { join } from "node:path";
import { initialMigrations } from "./index.js";

for (const migration of initialMigrations) {
  accessSync(join(process.cwd(), migration.path));
}

console.log(`Found ${initialMigrations.length} migration file(s).`);
