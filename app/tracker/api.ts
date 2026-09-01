export type Employee = {
  id: string;
  name: string;
  hourlyRate: number;
  active: boolean;
};

export type Entity = {
  id: string;
  name: string;
  active: boolean;
  dateAdded?: string;
};

export type PropertySite = {
  id: string;
  name: string;
  address: string;
  entityId?: string;
  entityName?: string;
  active: boolean;
  dateAdded?: string;
};

export type WorkEntry = {
  id: string;
  employeeId: string;
  propertyId: string;
  entityId?: string;
  employeeName?: string;
  propertyName?: string;
  entityName?: string;
  date: string;
  hours: number;
  description: string;
  notes?: string;
  photos: string[];
  laborCost?: number;
};

export type DashboardStats = {
  weekHours: number;
  monthHours: number;
  weekCost: number;
  monthCost: number;
  activeEmployees: number;
  activeProperties: number;
  activeEntities: number;
};

export type WorkEntryPayload = {
  employeeId: string;
  propertyId: string;
  entityId?: string;
  entityName?: string;
  date: string;
  hours: number;
  description: string;
  notes?: string;
  photos: string[];
};

type RawRecord = Record<string, unknown>;

const endpoint = "/api/google-apps-script";
const REQUEST_TIMEOUT_MS = 80000;

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unwrapData(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return value;
  }

  for (const key of keys) {
    if (key in value) {
      return value[key];
    }
  }

  if ("data" in value) {
    return value.data;
  }

  return value;
}

function listFrom(value: unknown, keys: string[]) {
  const unwrapped = unwrapData(value, keys);
  if (Array.isArray(unwrapped)) {
    return unwrapped;
  }

  if (isRecord(unwrapped)) {
    for (const key of keys) {
      const nested = unwrapped[key];
      if (Array.isArray(nested)) {
        return nested;
      }
    }
  }

  return [];
}

function pick(record: RawRecord, keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }

  return undefined;
}

function asString(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function asBoolean(value: unknown, fallback = true) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["active", "true", "yes", "y", "1"].includes(normalized)) {
      return true;
    }
    if (["inactive", "false", "no", "n", "0", "deleted"].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function asDate(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + value * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  const text = asString(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}

function asPhotos(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter(Boolean);
  }

  const text = asString(value);
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => asString(item)).filter(Boolean);
    }
  } catch {
    return text
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fallbackId(prefix: string, index: number, text: string) {
  const slug =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "record";
  return `${prefix}-${slug}-${index + 1}`;
}

function byName<T extends { id: string; name: string }>(items: T[], name: string) {
  const normalized = name.trim().toLowerCase();
  return items.find((item) => item.name.trim().toLowerCase() === normalized);
}

function byId<T extends { id: string }>(items: T[], id: string) {
  return items.find((item) => item.id === id);
}

function entryCost(entry: WorkEntry, employees: Employee[]) {
  return typeof entry.laborCost === "number" && Number.isFinite(entry.laborCost)
    ? entry.laborCost
    : entry.hours *
        (employees.find((employee) => employee.id === entry.employeeId)?.hourlyRate ??
          0);
}

async function requestBackend<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The backend took too long to respond. Please retry.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; data?: T; error?: string }
    | null;

  if (!response.ok || body?.ok === false) {
    throw new Error(
      body?.error ?? `Backend request failed with status ${response.status}.`,
    );
  }

  return body?.data as T;
}

export async function getAction<T>(action: string) {
  return requestBackend<T>(`${endpoint}?action=${encodeURIComponent(action)}`, {
    method: "GET",
  });
}

export async function postAction<T>(
  action: string,
  payload: Record<string, unknown>,
) {
  return requestBackend<T>(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, payload }),
  });
}

export function normalizeEmployees(value: unknown): Employee[] {
  return listFrom(value, ["employees", "Employees"]).map((item, index) => {
    const record = isRecord(item) ? item : {};
    const name = asString(
      pick(record, ["name", "Name", "employeeName", "Employee Name", "Employee"]),
      `Employee ${index + 1}`,
    );

    return {
      id: asString(
        pick(record, ["id", "ID", "employeeId", "Employee ID", "EmployeeID"]),
        fallbackId("emp", index, name),
      ),
      name,
      hourlyRate: asNumber(
        pick(record, [
          "hourlyRate",
          "Hourly Rate",
          "rate",
          "Rate",
          "hourly_rate",
        ]),
      ),
      active: asBoolean(pick(record, ["active", "Active", "status", "Status"])),
    };
  });
}

export function normalizeEntities(value: unknown): Entity[] {
  return listFrom(value, ["entities", "Entities"]).map((item, index) => {
    const record = isRecord(item) ? item : {};
    const name = asString(
      pick(record, ["entityName", "Entity Name", "name", "Name", "Entity"]),
      `Entity ${index + 1}`,
    );

    return {
      id: asString(
        pick(record, ["entityId", "Entity ID", "EntityID", "id", "ID"]),
        fallbackId("entity", index, name),
      ),
      name,
      active: asBoolean(pick(record, ["active", "Active", "status", "Status"])),
      dateAdded: asString(pick(record, ["dateAdded", "Date Added", "createdAt"])),
    };
  });
}

export function normalizeProperties(
  value: unknown,
  entities: Entity[] = [],
): PropertySite[] {
  return listFrom(value, ["properties", "Properties"]).map((item, index) => {
    const record = isRecord(item) ? item : {};
    const name = asString(
      pick(record, [
        "name",
        "Name",
        "propertyName",
        "Property Name",
        "Property",
        "jobSite",
        "Job Site",
      ]),
      `Property ${index + 1}`,
    );
    const entityName = asString(
      pick(record, ["entityName", "Entity Name", "entity", "Entity"]),
    );
    const entityId = asString(
      pick(record, ["entityId", "Entity ID", "EntityID"]),
      byName(entities, entityName)?.id ?? "",
    );

    return {
      id: asString(
        pick(record, ["id", "ID", "propertyId", "Property ID", "PropertyID"]),
        fallbackId("prop", index, name),
      ),
      name,
      address: asString(
        pick(record, ["address", "Address", "propertyAddress", "Property Address"]),
      ),
      entityId,
      entityName: entityName || byId(entities, entityId)?.name,
      active: asBoolean(pick(record, ["active", "Active", "status", "Status"])),
      dateAdded: asString(pick(record, ["dateAdded", "Date Added", "createdAt"])),
    };
  });
}

export function normalizeWorkEntries(
  value: unknown,
  employees: Employee[],
  properties: PropertySite[],
  entities: Entity[] = [],
): WorkEntry[] {
  return listFrom(value, ["workEntries", "entries", "Work Entries", "Entries"]).map(
    (item, index) => {
      const record = isRecord(item) ? item : {};
      const employeeName = asString(
        pick(record, ["employeeName", "Employee Name", "employee", "Employee"]),
      );
      const propertyName = asString(
        pick(record, [
          "propertyName",
          "Property Name",
          "property",
          "Property",
          "jobSite",
          "Job Site",
        ]),
      );
      const employeeId = asString(
        pick(record, ["employeeId", "Employee ID", "EmployeeID", "workerId"]),
        byName(employees, employeeName)?.id ?? employeeName,
      );
      const propertyId = asString(
        pick(record, ["propertyId", "Property ID", "PropertyID"]),
        byName(properties, propertyName)?.id ?? propertyName,
      );
      const property = properties.find((item) => item.id === propertyId);
      const entityName = asString(
        pick(record, ["entityName", "Entity Name", "entity", "Entity"]),
        property?.entityName ?? "",
      );
      const entityId = asString(
        pick(record, ["entityId", "Entity ID", "EntityID"]),
        property?.entityId ?? byName(entities, entityName)?.id ?? "",
      );
      const description = asString(
        pick(record, [
          "description",
          "Description",
          "workPerformed",
          "Work Performed",
          "work",
          "Work",
        ]),
      );
      const idText = `${employeeId}-${propertyId}-${description}`;

      const laborCost = asNumber(
        pick(record, [
          "laborCost",
          "Labor Cost",
          "cost",
          "Cost",
          "estimatedLaborCost",
        ]),
        Number.NaN,
      );

      return {
        id: asString(
          pick(record, ["id", "ID", "entryId", "Entry ID", "Work Entry ID"]),
          fallbackId("entry", index, idText),
        ),
        employeeId,
        propertyId,
        entityId,
        employeeName,
        propertyName,
        entityName: entityName || byId(entities, entityId)?.name,
        date: asDate(pick(record, ["date", "Date", "workDate", "Work Date"])),
        hours: asNumber(pick(record, ["hours", "Hours", "hoursWorked"])),
        description,
        notes: asString(pick(record, ["notes", "Notes"])),
        photos: asPhotos(
          pick(record, [
            "photos",
            "Photos",
            "photoUrls",
            "Photo URLs",
            "photoURLS",
            "photoUrl",
            "Photo URL",
          ]),
        ),
        laborCost: Number.isFinite(laborCost) ? laborCost : undefined,
      };
    },
  );
}

export function normalizeDashboard(value: unknown): Partial<DashboardStats> {
  const data = unwrapData(value, ["dashboard", "Dashboard", "stats", "summary"]);
  if (!isRecord(data)) {
    return {};
  }

  return {
    weekHours: asNumber(
      pick(data, [
        "weekHours",
        "weeklyHours",
        "totalLaborHoursThisWeek",
        "Total Labor Hours This Week",
      ]),
      Number.NaN,
    ),
    monthHours: asNumber(
      pick(data, [
        "monthHours",
        "monthlyHours",
        "totalLaborHoursThisMonth",
        "Total Labor Hours This Month",
      ]),
      Number.NaN,
    ),
    weekCost: asNumber(
      pick(data, [
        "weekCost",
        "weeklyCost",
        "totalLaborCostThisWeek",
        "Total Labor Cost This Week",
      ]),
      Number.NaN,
    ),
    monthCost: asNumber(
      pick(data, [
        "monthCost",
        "monthlyCost",
        "totalLaborCostThisMonth",
        "Total Labor Cost This Month",
      ]),
      Number.NaN,
    ),
    activeEmployees: asNumber(
      pick(data, ["activeEmployees", "activeWorkers", "Number of Active Workers"]),
      Number.NaN,
    ),
    activeProperties: asNumber(
      pick(data, [
        "activeProperties",
        "activeJobSites",
        "Number of Active Properties",
      ]),
      Number.NaN,
    ),
    activeEntities: asNumber(
      pick(data, ["activeEntities", "Number of Active Entities"]),
      Number.NaN,
    ),
  };
}

export function deriveDashboard(
  dashboard: Partial<DashboardStats>,
  employees: Employee[],
  properties: PropertySite[],
  entries: WorkEntry[],
  entities: Entity[] = [],
) {
  const now = new Date();
  const current = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const weekEntries = entries.filter((entry) => {
    const compare = new Date(`${entry.date}T12:00:00`).getTime();
    return compare >= current - 6 * 24 * 60 * 60 * 1000 && compare <= current;
  });
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthEntries = entries.filter((entry) => entry.date.slice(0, 7) === currentMonth);
  const sumHours = (list: WorkEntry[]) =>
    list.reduce((total, entry) => total + entry.hours, 0);
  const sumCost = (list: WorkEntry[]) =>
    list.reduce((total, entry) => total + entryCost(entry, employees), 0);
  const numberOr = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  return {
    weekHours: numberOr(dashboard.weekHours, sumHours(weekEntries)),
    monthHours: numberOr(dashboard.monthHours, sumHours(monthEntries)),
    weekCost: numberOr(dashboard.weekCost, sumCost(weekEntries)),
    monthCost: numberOr(dashboard.monthCost, sumCost(monthEntries)),
    activeEmployees: numberOr(
      dashboard.activeEmployees,
      employees.filter((employee) => employee.active).length,
    ),
    activeProperties: numberOr(
      dashboard.activeProperties,
      properties.filter((property) => property.active).length,
    ),
    activeEntities: numberOr(
      dashboard.activeEntities,
      entities.filter((entity) => entity.active).length,
    ),
  };
}

export function normalizeUploadPhotoResponse(value: unknown) {
  const data = unwrapData(value, ["photo", "file", "upload"]);
  if (!isRecord(data)) {
    return asString(data);
  }

  return asString(
    pick(data, [
      "url",
      "URL",
      "photoUrl",
      "photoURL",
      "fileUrl",
      "webViewLink",
      "downloadUrl",
    ]),
  );
}
