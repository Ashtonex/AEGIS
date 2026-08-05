#!/usr/bin/env node
// Diffs the static routes under src/app/dashboard against the hrefs wired
// into DashboardShell.tsx's sidebar, so a new page shipped without a nav
// link fails a check instead of quietly going unreachable (the exact bug
// class fixed in commits 6cf34cb/4c58bab).

const fs = require("fs");
const path = require("path");

const DASHBOARD_DIR = path.join(__dirname, "..", "src", "app", "dashboard");
const SHELL_FILE = path.join(__dirname, "..", "src", "app", "dashboard", "DashboardShell.tsx");

// Routes that are intentionally not linked from the sidebar - keep this
// list short and explain why each entry is here.
const ALLOWLIST = new Set([
  "/dashboard", // redirects straight to /dashboard/executive
  "/dashboard/crm/quotations", // legacy redirect stub -> /dashboard/quotations
]);

function walkPageRoutes(dir, baseDir) {
  const routes = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      routes.push(...walkPageRoutes(fullPath, baseDir));
    } else if (entry.isFile() && entry.name === "page.tsx") {
      const routeDir = path.dirname(path.relative(baseDir, fullPath));
      const route = "/dashboard" + (routeDir === "." ? "" : `/${routeDir.replace(/\\/g, "/")}`);
      routes.push(route);
    }
  }
  return routes;
}

function isDynamicRoute(route) {
  return route.includes("[");
}

function extractNavHrefs(shellSource) {
  const hrefs = new Set();
  const hrefPattern = /href:\s*"([^"]+)"/g;
  let match;
  while ((match = hrefPattern.exec(shellSource)) !== null) {
    hrefs.add(match[1]);
  }
  return hrefs;
}

function main() {
  const allRoutes = walkPageRoutes(DASHBOARD_DIR, DASHBOARD_DIR);
  const staticRoutes = allRoutes.filter((route) => !isDynamicRoute(route));
  const shellSource = fs.readFileSync(SHELL_FILE, "utf8");
  const navHrefs = extractNavHrefs(shellSource);

  const orphaned = staticRoutes.filter(
    (route) => !navHrefs.has(route) && !ALLOWLIST.has(route)
  );

  if (orphaned.length > 0) {
    console.error("Nav completeness check failed - these dashboard pages have no sidebar link:\n");
    for (const route of orphaned.sort()) {
      console.error(`  ${route}`);
    }
    console.error(
      "\nAdd a link in DashboardShell.tsx's MODULE_GROUPS, or add the route to the ALLOWLIST in scripts/check-nav-completeness.js with a comment explaining why it's intentionally unlinked."
    );
    process.exit(1);
  }

  console.log(`Nav completeness check passed - ${staticRoutes.length} static dashboard routes all reachable from the sidebar.`);
}

main();
