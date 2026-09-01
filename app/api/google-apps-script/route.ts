import { hasInternalSessionFromRequest } from "../../internal-auth";

const backendUrl =
  process.env.GOOGLE_APPS_SCRIPT_URL ??
  process.env.NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_URL;

const getActions = new Set([
  "getEntities",
  "getEmployees",
  "getProperties",
  "getWorkEntries",
  "getDashboard",
]);

const postActions = new Set([
  "addEntity",
  "updateEntity",
  "deleteEntity",
  "addEmployee",
  "updateEmployee",
  "deleteEmployee",
  "addProperty",
  "updateProperty",
  "deleteProperty",
  "addWorkEntry",
  "updateWorkEntry",
  "deleteWorkEntry",
  "uploadPhoto",
]);

const APPS_SCRIPT_GET_TIMEOUT_MS = 12000;
const APPS_SCRIPT_POST_TIMEOUT_MS = 60000;
const APPS_SCRIPT_GET_CACHE_TTL_MS = 5 * 60 * 1000;
const APPS_SCRIPT_GET_STALE_TTL_MS = 60 * 60 * 1000;
const MAX_APPS_SCRIPT_REDIRECTS = 5;
const BROWSER_LIKE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "User-Agent":
    "Mozilla/5.0 (compatible; TR-Properties-Labor-Tracker/1.0; +https://tr-properties-labor-tracker.tr-properties-labor.workers.dev)",
};

type CacheEntry = {
  data: unknown;
  savedAt: number;
};

const getCache = new Map<string, CacheEntry>();
const edgeCachePrefix = "https://tr-properties-labor-tracker.internal/google-apps-script/";

type ProxyPayload = {
  action?: string;
  payload?: Record<string, unknown>;
};

function routeError(message: string, status = 500) {
  return Response.json({ ok: false, error: message }, { status });
}

function isGoogleSignInHtml(text: string) {
  const lower = text.toLowerCase();
  return (
    lower.includes("<html") &&
    (lower.includes("sign in - google accounts") ||
      lower.includes("accountchooser") ||
      lower.includes("accounts.google.com"))
  );
}

async function parseAppsScriptResponse(response: Response) {
  const text = await response.text();

  if (isGoogleSignInHtml(text)) {
    throw new Error(
      "Google Apps Script requires TR Properties Google sign-in or a deployment access change before this app can read the backend.",
    );
  }

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (text.toLowerCase().includes("<html")) {
      throw new Error(
        "Google Apps Script returned an HTML page instead of JSON. Confirm the web app deployment is accessible to this server-side proxy and returns JSON for API actions.",
      );
    }

    throw new Error("Google Apps Script returned a non-JSON response.");
  }
}

function mergeHeaders(headers?: HeadersInit) {
  return {
    ...BROWSER_LIKE_HEADERS,
    ...(headers ?? {}),
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAppsScript(
  url: URL,
  init: RequestInit,
  timeoutMs: number,
) {
  let currentUrl = url.toString();
  let currentInit = init;
  const deadline = Date.now() + timeoutMs;

  for (let redirectCount = 0; redirectCount <= MAX_APPS_SCRIPT_REDIRECTS; redirectCount += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        "Google Apps Script took too long to respond. Please retry in a moment.",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);

    try {
      const response = await fetch(currentUrl, {
        ...currentInit,
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: mergeHeaders(currentInit.headers),
      });

      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has("location")
      ) {
        const location = response.headers.get("location") ?? "";
        currentUrl = new URL(location, currentUrl).toString();
        currentInit =
          response.status === 307 || response.status === 308
            ? currentInit
            : {
                method: "GET",
                headers: currentInit.headers,
              };
        continue;
      }

      return response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          "Google Apps Script took too long to respond. Please retry in a moment.",
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Google Apps Script redirected too many times.");
}

async function getEdgeCache(action: string) {
  if (typeof caches === "undefined") {
    return null;
  }

  const response = await caches.default.match(`${edgeCachePrefix}${action}`);
  if (!response) {
    return null;
  }

  return (await response.json().catch(() => null)) as CacheEntry | null;
}

async function setEdgeCache(action: string, entry: CacheEntry) {
  if (typeof caches === "undefined") {
    return;
  }

  await caches.default.put(
    `${edgeCachePrefix}${action}`,
    Response.json(entry, {
      headers: {
        "Cache-Control": `private, max-age=${Math.floor(
          APPS_SCRIPT_GET_STALE_TTL_MS / 1000,
        )}`,
      },
    }),
  );
}

async function clearReadCaches() {
  getCache.clear();

  if (typeof caches === "undefined") {
    return;
  }

  await Promise.all(
    [...getActions].map((action) =>
      caches.default.delete(`${edgeCachePrefix}${action}`),
    ),
  );
}

async function forwardToAppsScript(action: string, init?: RequestInit) {
  if (!backendUrl) {
    throw new Error(
      "Missing GOOGLE_APPS_SCRIPT_URL or NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_URL.",
    );
  }

  const url = new URL(backendUrl);
  url.searchParams.set("action", action);
  const method = init?.method?.toUpperCase() ?? "GET";
  const isGet = method === "GET";
  const memoryCached = getCache.get(action);
  const edgeCached = isGet ? await getEdgeCache(action) : null;
  const cached = memoryCached ?? edgeCached ?? undefined;
  const now = Date.now();

  if (
    isGet &&
    cached &&
    now - cached.savedAt < APPS_SCRIPT_GET_CACHE_TTL_MS
  ) {
    return cached.data;
  }

  const attempts = isGet ? 2 : 1;
  const timeoutMs = isGet
    ? APPS_SCRIPT_GET_TIMEOUT_MS
    : APPS_SCRIPT_POST_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchAppsScript(
        url,
        {
          method,
          ...init,
          headers: mergeHeaders(init?.headers),
        },
        timeoutMs,
      );
      const data = await parseAppsScriptResponse(response);

      if (!response.ok) {
        const message =
          data &&
          typeof data === "object" &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : `Google Apps Script request failed with status ${response.status}.`;
        throw new Error(message);
      }

      if (
        data &&
        typeof data === "object" &&
        "success" in data &&
        data.success === false
      ) {
        const message =
          "error" in data && typeof data.error === "string"
            ? data.error
            : "Google Apps Script reported an error.";
        throw new Error(message);
      }

      if (isGet) {
        const entry = { data, savedAt: Date.now() };
        getCache.set(action, entry);
        await setEdgeCache(action, entry);
      }

      return data;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await delay(800);
      }
    }
  }

  if (
    isGet &&
    cached &&
    now - cached.savedAt < APPS_SCRIPT_GET_STALE_TTL_MS
  ) {
    return cached.data;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Google Apps Script request failed.");
}

export async function GET(request: Request) {
  try {
    if (!(await hasInternalSessionFromRequest(request))) {
      return routeError("Please log in to access TR Properties data.", 401);
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") ?? "";

    if (!getActions.has(action)) {
      return routeError("Unsupported GET action.", 400);
    }

    const data = await forwardToAppsScript(action, { method: "GET" });
    return Response.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return routeError(message, 502);
  }
}

export async function POST(request: Request) {
  try {
    if (!(await hasInternalSessionFromRequest(request))) {
      return routeError("Please log in to access TR Properties data.", 401);
    }

    const body = (await request.json()) as ProxyPayload;
    const action = body.action ?? "";

    if (!postActions.has(action)) {
      return routeError("Unsupported POST action.", 400);
    }

    const data = await forwardToAppsScript(action, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        ...(body.payload ?? {}),
      }),
    });

    await clearReadCaches();

    return Response.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return routeError(message, 502);
  }
}
