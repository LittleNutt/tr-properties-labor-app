import { hasInternalSessionFromRequest } from "../../internal-auth";
import { getRequestExecutionContext } from "vinext/shims/request-context";

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

const APPS_SCRIPT_GET_TIMEOUT_MS = 45000;
const APPS_SCRIPT_POST_TIMEOUT_MS = 60000;
const APPS_SCRIPT_GET_CACHE_TTL_MS = 5 * 60 * 1000;
const APPS_SCRIPT_GET_STALE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
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

type LaborCacheNamespace = {
  get(
    key: string,
    options: { cacheTtl: number; type: "json" },
  ): Promise<CacheEntry | null>;
  put(key: string, value: string): Promise<void>;
};

type LaborExecutionContext = {
  laborCache?: LaborCacheNamespace;
  waitUntil(promise: Promise<unknown>): void;
};

const getCache = new Map<string, CacheEntry>();
const edgeCachePrefix = "https://tr-properties-labor-tracker.internal/google-apps-script/";
const kvCachePrefix = "google-apps-script:";

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

function getLaborCache() {
  const context = getRequestExecutionContext() as LaborExecutionContext | null;
  return context?.laborCache;
}

function reportCacheError(operation: string, action: string, error: unknown) {
  console.warn(
    JSON.stringify({
      event: "labor_cache_error",
      operation,
      action,
      message: error instanceof Error ? error.message : String(error),
    }),
  );
}

function getDefaultCache() {
  if (typeof caches === "undefined") {
    return null;
  }

  return (caches as CacheStorage & { default?: Cache }).default ?? null;
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
  const cache = getDefaultCache();
  if (!cache) {
    return null;
  }

  try {
    const response = await cache.match(`${edgeCachePrefix}${action}`);
    if (!response) {
      return null;
    }

    return (await response.json().catch(() => null)) as CacheEntry | null;
  } catch (error) {
    reportCacheError("edge_get", action, error);
    return null;
  }
}

async function getKvCache(action: string) {
  const cache = getLaborCache();
  if (!cache) {
    return null;
  }

  try {
    return await cache.get(`${kvCachePrefix}${action}`, {
      cacheTtl: 30,
      type: "json",
    });
  } catch (error) {
    reportCacheError("get", action, error);
    return null;
  }
}

async function setEdgeCache(action: string, entry: CacheEntry) {
  const cache = getDefaultCache();
  if (!cache) {
    return;
  }

  try {
    await cache.put(
      `${edgeCachePrefix}${action}`,
      Response.json(entry, {
        headers: {
          "Cache-Control": `public, max-age=${Math.floor(
            APPS_SCRIPT_GET_STALE_TTL_MS / 1000,
          )}`,
        },
      }),
    );
  } catch (error) {
    reportCacheError("edge_put", action, error);
  }
}

async function setKvCache(action: string, entry: CacheEntry) {
  const cache = getLaborCache();
  if (!cache) {
    return;
  }

  try {
    await cache.put(`${kvCachePrefix}${action}`, JSON.stringify(entry));
  } catch (error) {
    reportCacheError("put", action, error);
  }
}

async function setReadCache(action: string, entry: CacheEntry) {
  getCache.set(action, entry);
  await Promise.all([setEdgeCache(action, entry), setKvCache(action, entry)]);
}

async function getReadCache(action: string) {
  const memoryCached = getCache.get(action);
  const [edgeCached, kvCached] = await Promise.all([
    getEdgeCache(action),
    getKvCache(action),
  ]);
  const cached = [memoryCached, edgeCached, kvCached]
    .filter((entry): entry is CacheEntry => Boolean(entry))
    .sort((left, right) => right.savedAt - left.savedAt)[0];

  if (cached) {
    getCache.set(action, cached);
  }

  return cached;
}

async function markReadCachesStale() {
  const cacheEntries = await Promise.all(
    [...getActions].map(async (action) => ({
      action,
      entry: await getReadCache(action),
    })),
  );

  await Promise.all(
    cacheEntries.map(async ({ action, entry }) => {
      if (entry) {
        const staleEntry = {
          ...entry,
          savedAt: Date.now() - APPS_SCRIPT_GET_CACHE_TTL_MS - 1,
        };
        getCache.set(action, staleEntry);
        await setKvCache(action, staleEntry);
      } else {
        getCache.delete(action);
      }

      const cache = getDefaultCache();
      if (cache) {
        try {
          await cache.delete(`${edgeCachePrefix}${action}`);
        } catch (error) {
          reportCacheError("edge_delete", action, error);
        }
      }
    }),
  );
}

async function fetchLiveData(
  action: string,
  url: URL,
  method: string,
  init: RequestInit | undefined,
) {
  const isGet = method === "GET";
  const response = await fetchAppsScript(
    url,
    {
      method,
      ...init,
      headers: mergeHeaders(init?.headers),
    },
    isGet ? APPS_SCRIPT_GET_TIMEOUT_MS : APPS_SCRIPT_POST_TIMEOUT_MS,
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
    await setReadCache(action, { data, savedAt: Date.now() });
  }

  return data;
}

function refreshInBackground(refresh: Promise<unknown>, action: string) {
  const guardedRefresh = refresh.catch((error) => {
    console.warn(
      JSON.stringify({
        event: "google_apps_script_background_refresh_failed",
        action,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  });
  const context = getRequestExecutionContext();

  if (context) {
    context.waitUntil(guardedRefresh);
    return true;
  }

  return false;
}

async function forwardToAppsScript(
  action: string,
  init?: RequestInit,
  options: { forceRefresh?: boolean } = {},
) {
  if (!backendUrl) {
    throw new Error(
      "Missing GOOGLE_APPS_SCRIPT_URL or NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_URL.",
    );
  }

  const url = new URL(backendUrl);
  url.searchParams.set("action", action);
  const method = init?.method?.toUpperCase() ?? "GET";
  const isGet = method === "GET";
  const cached = isGet ? await getReadCache(action) : undefined;
  const now = Date.now();

  if (
    isGet &&
    cached &&
    !options.forceRefresh &&
    now - cached.savedAt < APPS_SCRIPT_GET_CACHE_TTL_MS
  ) {
    return cached.data;
  }

  const liveRequest = fetchLiveData(action, url, method, init);
  if (isGet && cached && !options.forceRefresh) {
    if (refreshInBackground(liveRequest, action)) {
      return cached.data;
    }

    try {
      return await liveRequest;
    } catch {
      return cached.data;
    }
  }

  try {
    return await liveRequest;
  } catch (error) {
    if (
      isGet &&
      cached &&
      now - cached.savedAt < APPS_SCRIPT_GET_STALE_TTL_MS
    ) {
      return cached.data;
    }

    throw error;
  }
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

    const data = await forwardToAppsScript(
      action,
      { method: "GET" },
      { forceRefresh: searchParams.get("fresh") === "1" },
    );
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

    await markReadCachesStale();

    return Response.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return routeError(message, 502);
  }
}
