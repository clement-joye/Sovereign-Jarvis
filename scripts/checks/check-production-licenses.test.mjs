import assert from "node:assert/strict";
import test from "node:test";

import { normalizeInventory, validateLicenses } from "./check-production-licenses.mjs";

test("normalizes license reports deterministically without repository paths", () => {
  const report = {
    MIT: [
      {
        name: "z-package",
        versions: ["2.0.0"],
        paths: ["/private/operator/checkout/node_modules/z-package"],
        author: "Zed",
        homepage: "https://example.test/z"
      }
    ],
    Apache: [
      {
        name: "a-package",
        versions: ["1.0.0"],
        license: "Apache-2.0"
      }
    ]
  };

  const first = normalizeInventory(report, "lock-digest");
  const second = normalizeInventory(report, "lock-digest");

  assert.deepEqual(first, second);
  assert.deepEqual(first.packages, [
    { name: "a-package", version: "1.0.0", license: "Apache-2.0" },
    {
      name: "z-package",
      version: "2.0.0",
      license: "MIT",
      author: "Zed",
      homepage: "https://example.test/z"
    }
  ]);
  assert.equal(JSON.stringify(first).includes("/private/operator/checkout"), false);
});

test("accepts every reviewed permissive license", () => {
  const licenses = [
    "0BSD",
    "(AFL-2.1 OR BSD-3-Clause)",
    "Apache-2.0",
    "BlueOak-1.0.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "MIT",
    "Unlicense"
  ];
  const inventory = {
    packages: licenses.map((license, index) => ({
      name: `package-${index}`,
      version: "1.0.0",
      license
    }))
  };

  assert.doesNotThrow(() => validateLicenses(inventory));
});

test("rejects disallowed copyleft licenses", () => {
  const inventory = {
    packages: [{ name: "copyleft-package", version: "1.0.0", license: "GPL-3.0-only" }]
  };

  assert.throws(() => validateLicenses(inventory), /copyleft-package@1\.0\.0: GPL-3\.0-only/);
});

test("rejects unknown licenses", () => {
  const inventory = {
    packages: [{ name: "unknown-package", version: "1.0.0", license: "Custom-License" }]
  };

  assert.throws(() => validateLicenses(inventory), /unknown-package@1\.0\.0: Custom-License/);
});
