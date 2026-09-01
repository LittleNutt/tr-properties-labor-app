import assert from "node:assert/strict";
import test from "node:test";

const baseEnv = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
  GOOGLE_APPS_SCRIPT_URL: "https://example.com/apps-script",
  TRP_INTERNAL_PASSWORD: "test-password",
};

async function render(pathname = "/", env = {}) {
  const processEnv = { ...baseEnv, ...env };
  const previousEnv = {};
  for (const key of Object.keys(processEnv)) {
    previousEnv[key] = process.env[key];
    if (typeof processEnv[key] === "string") {
      process.env[key] = processEnv[key];
    }
  }

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  try {
    const { default: worker } = await import(workerUrl.href);

    return await worker.fetch(
      new Request(`http://localhost${pathname}`, {
        headers: { accept: "text/html" },
      }),
      processEnv,
      {
        waitUntil() {},
        passThroughOnException() {},
      },
    );
  } finally {
    for (const key of Object.keys(processEnv)) {
      if (previousEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }
  }
}

test("redirects protected pages to the shared login screen", async () => {
  const response = await render("/");

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "/login?returnTo=%2F");
});

test("server-renders the dashboard when Cloudflare Access is trusted", async () => {
  const response = await render("/", {
    TRUST_CLOUDFLARE_ACCESS: "true",
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /TR Properties Labor Tracker/);
  assert.match(html, /Labor Command Center/);
  assert.match(html, /Dashboard/);
  assert.match(html, /Entities/);
  assert.match(html, /Log Work/);
  assert.match(html, /Employees/);
  assert.match(html, /Properties/);
  assert.match(html, /Work Entries/);
  assert.match(html, /Reports/);
});
