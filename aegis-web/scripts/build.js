const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { spawnSync } = require("node:child_process");

process.env.NEXT_PUBLIC_BUILD_PHASE = process.env.NEXT_PUBLIC_BUILD_PHASE || "true";
process.env.NEXT_TELEMETRY_DISABLED = process.env.NEXT_TELEMETRY_DISABLED || "1";

const nextBin = require.resolve("next/dist/bin/next");
const tscBin = require.resolve("typescript/bin/tsc");

const typecheck = spawnSync(
  process.execPath,
  [tscBin, "--noEmit", "--pretty", "false", "--incremental", "false"],
  {
    env: process.env,
    stdio: "inherit",
  },
);

if (typecheck.error) {
  console.error(typecheck.error);
  process.exit(1);
}

if ((typecheck.status ?? 1) !== 0) {
  process.exit(typecheck.status ?? 1);
}

function runBuild() {
  return spawnSync(process.execPath, [nextBin, "build"], {
    env: { ...process.env, AEGIS_SKIP_NEXT_TYPECHECK: "1" },
    stdio: "inherit",
  });
}

let result = runBuild();

const pagesManifest = join(process.cwd(), ".next", "server", "pages-manifest.json");
if ((result.status ?? 1) !== 0 && !existsSync(pagesManifest)) {
  mkdirSync(dirname(pagesManifest), { recursive: true });
  writeFileSync(pagesManifest, "{}", "utf8");
  result = runBuild();
}

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
