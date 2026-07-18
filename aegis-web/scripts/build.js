const {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} = require("node:fs");
const { dirname, join } = require("node:path");
const { spawnSync } = require("node:child_process");

process.env.NEXT_PUBLIC_BUILD_PHASE = process.env.NEXT_PUBLIC_BUILD_PHASE || "true";
process.env.NEXT_TELEMETRY_DISABLED = process.env.NEXT_TELEMETRY_DISABLED || "1";

const nextBin = require.resolve("next/dist/bin/next");
const tscBin = require.resolve("typescript/bin/tsc");
const buildLock = join(process.cwd(), ".aegis-build.lock");

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireBuildLock() {
  try {
    const descriptor = openSync(buildLock, "wx");
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid }), "utf8");
    return descriptor;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;

    let ownerPid;
    try {
      ownerPid = JSON.parse(readFileSync(buildLock, "utf8")).pid;
    } catch {
      ownerPid = undefined;
    }

    if (processIsRunning(ownerPid)) {
      throw new Error(`Another AEGIS frontend build is already running (PID ${ownerPid}).`);
    }

    unlinkSync(buildLock);
    const descriptor = openSync(buildLock, "wx");
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid }), "utf8");
    return descriptor;
  }
}

function runBuild() {
  return spawnSync(process.execPath, [nextBin, "build"], {
    env: { ...process.env, AEGIS_SKIP_NEXT_TYPECHECK: "1" },
    stdio: "inherit",
  });
}

function build() {
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
    return 1;
  }

  if ((typecheck.status ?? 1) !== 0) {
    return typecheck.status ?? 1;
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
    return 1;
  }

  return result.status ?? 1;
}

let lockDescriptor;
let status = 1;
let lockAcquired = false;

function releaseBuildLock() {
  if (!lockAcquired) return;

  try {
    if (lockDescriptor !== undefined) {
      closeSync(lockDescriptor);
    }
  } catch {}

  try {
    unlinkSync(buildLock);
  } catch {}

  lockAcquired = false;
  lockDescriptor = undefined;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.on(signal, () => {
    releaseBuildLock();
    process.exit(1);
  });
}

process.on("exit", releaseBuildLock);

try {
  lockDescriptor = acquireBuildLock();
  lockAcquired = true;
  status = build();
} catch (error) {
  console.error(error);
} finally {
  releaseBuildLock();
}

process.exit(status);
