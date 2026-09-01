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

async function forwardToAppsScript(action: string, init?: RequestInit) {
  if (!backendUrl) {
    throw new Error(
      "Missing GOOGLE_APPS_SCRIPT_URL or NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_URL.",
    );
  }

  const url = new URL(backendUrl);
  url.searchParams.set("action", action);

  const response = await fetch(url, {
    redirect: "follow",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
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

  return data;
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

    return Response.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return routeError(message, 502);
  }
}
