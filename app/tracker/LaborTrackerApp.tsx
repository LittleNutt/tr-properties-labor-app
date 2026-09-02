"use client";

import {
  AnchorHTMLAttributes,
  ChangeEvent,
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DashboardStats,
  Employee,
  Entity,
  PropertySite,
  WorkEntry,
  WorkEntryPayload,
  deriveDashboard,
  getAction,
  normalizeDashboard,
  normalizeEmployees,
  normalizeEntities,
  normalizeProperties,
  normalizeUploadPhotoResponse,
  normalizeWorkEntries,
  postAction,
} from "./api";

type View =
  | "dashboard"
  | "entities"
  | "log-work"
  | "employees"
  | "properties"
  | "property-detail"
  | "work-entries"
  | "reports"
  | "login";

type Toast = {
  id: string;
  message: string;
  kind: "success" | "info" | "error";
};

type LaborTrackerAppProps = {
  initialView: View;
  propertyId?: string;
};

type EmployeeForm = {
  name: string;
  hourlyRate: string;
  active: boolean;
};

type EntityForm = {
  name: string;
  active: boolean;
};

type PropertyForm = {
  name: string;
  address: string;
  entityId: string;
  active: boolean;
};

type EntryForm = {
  employeeId: string;
  propertyId: string;
  date: string;
  hours: string;
  description: string;
  notes: string;
};

const navItems: { view: View; href: string; label: string; symbol: string }[] = [
  { view: "dashboard", href: "/", label: "Dashboard", symbol: "D" },
  { view: "entities", href: "/entities", label: "Entities", symbol: "N" },
  { view: "log-work", href: "/log-work", label: "Log Work", symbol: "+" },
  { view: "employees", href: "/employees", label: "Employees", symbol: "E" },
  { view: "properties", href: "/properties", label: "Properties", symbol: "P" },
  {
    view: "work-entries",
    href: "/work-entries",
    label: "Work Entries",
    symbol: "W",
  },
  { view: "reports", href: "/reports", label: "Reports", symbol: "R" },
];

function Link({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

const today = new Date().toISOString().slice(0, 10);

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }

  return `${prefix}-${Date.now()}`;
}

function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function hourlyRateCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 20,
  }).format(value);
}

function shortDate(value: string) {
  const date = value.includes("T") ? new Date(value) : new Date(`${value}T12:00:00`);

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function withinDays(date: string, days: number) {
  const current = new Date(`${today}T12:00:00`).getTime();
  const compare = new Date(`${date}T12:00:00`).getTime();
  return compare >= current - days * 24 * 60 * 60 * 1000 && compare <= current;
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function getEmployee(employees: Employee[], id: string) {
  return employees.find((employee) => employee.id === id);
}

function getProperty(properties: PropertySite[], id: string) {
  return properties.find((property) => property.id === id);
}

function getEntity(entities: Entity[], id?: string) {
  return id ? entities.find((entity) => entity.id === id) : undefined;
}

function getPropertyEntity(
  property: PropertySite | undefined,
  entities: Entity[],
) {
  if (!property) {
    return undefined;
  }

  return getEntity(entities, property.entityId);
}

function getEntryEntity(
  entry: WorkEntry,
  properties: PropertySite[],
  entities: Entity[],
) {
  return (
    getEntity(entities, entry.entityId) ??
    getPropertyEntity(getProperty(properties, entry.propertyId), entities)
  );
}

function getEntryEntityId(entry: WorkEntry, properties: PropertySite[]) {
  return (
    entry.entityId ||
    getProperty(properties, entry.propertyId)?.entityId ||
    entry.entityName ||
    "unassigned"
  );
}

function getEntryEntityName(
  entry: WorkEntry,
  properties: PropertySite[],
  entities: Entity[],
) {
  return (
    getEntryEntity(entry, properties, entities)?.name ??
    entry.entityName ??
    getProperty(properties, entry.propertyId)?.entityName ??
    "Unassigned"
  );
}

function entityLaborRows(
  entities: Entity[],
  properties: PropertySite[],
  entries: WorkEntry[],
  employees: Employee[],
) {
  const rows = entities.map((entity) => {
    const entityEntries = entries.filter(
      (entry) => getEntryEntityId(entry, properties) === entity.id,
    );
    const hours = entityEntries.reduce((sum, entry) => sum + entry.hours, 0);
    const cost = entityEntries.reduce(
      (sum, entry) => sum + entryCost(entry, employees),
      0,
    );

    return {
      id: entity.id,
      label: entity.name,
      value: hours,
      cost,
      active: entity.active,
      properties: properties.filter((property) => property.entityId === entity.id),
    };
  });
  const unassignedProperties = properties.filter((property) => !property.entityId);
  const unassignedEntries = entries.filter(
    (entry) => getEntryEntityId(entry, properties) === "unassigned",
  );

  if (unassignedProperties.length > 0 || unassignedEntries.length > 0) {
    rows.push({
      id: "unassigned",
      label: "Unassigned",
      value: unassignedEntries.reduce((sum, entry) => sum + entry.hours, 0),
      cost: unassignedEntries.reduce(
        (sum, entry) => sum + entryCost(entry, employees),
        0,
      ),
      active: false,
      properties: unassignedProperties,
    });
  }

  return rows.sort((a, b) => b.value - a.value);
}

function entryCost(entry: WorkEntry, employees: Employee[]) {
  return typeof entry.laborCost === "number" && Number.isFinite(entry.laborCost)
    ? entry.laborCost
    : entry.hours * (getEmployee(employees, entry.employeeId)?.hourlyRate ?? 0);
}

function classNames(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected backend error.";
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export function LaborTrackerApp({
  initialView,
  propertyId,
}: LaborTrackerAppProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [properties, setProperties] = useState<PropertySite[]>([]);
  const [entries, setEntries] = useState<WorkEntry[]>([]);
  const [dashboardStats, setDashboardStats] = useState<Partial<DashboardStats>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backendError, setBackendError] = useState("");
  const [entityBackendNotice, setEntityBackendNotice] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);

  function notify(message: string, kind: Toast["kind"] = "success") {
    const toast = { id: makeId("toast"), message, kind };
    setToasts((current) => [toast, ...current].slice(0, 3));
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== toast.id));
    }, 3400);
  }

  async function refreshData(
    options: { quiet?: boolean; forceFresh?: boolean } = {},
  ) {
    if (options.quiet) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setBackendError("");
      const failures: { action: string; message: string }[] = [];
      const loadAction = async (label: string, action: string) => {
        try {
          return await getAction<unknown>(action, {
            fresh: options.forceFresh,
          });
        } catch (error) {
          failures.push({ action, message: `${label}: ${errorMessage(error)}` });
          return null;
        }
      };
      const shouldLoad = (view: View, action: string) => {
        if (view === "dashboard") {
          return [
            "getDashboard",
            "getEmployees",
            "getEntities",
            "getProperties",
            "getWorkEntries",
          ].includes(action);
        }

        if (view === "entities") {
          return ["getEntities", "getProperties", "getWorkEntries", "getEmployees"].includes(action);
        }

        if (view === "employees") {
          return ["getEmployees", "getWorkEntries"].includes(action);
        }

        if (view === "properties" || view === "property-detail") {
          return ["getEntities", "getProperties", "getWorkEntries", "getEmployees"].includes(action);
        }

        if (view === "log-work") {
          return ["getEntities", "getEmployees", "getProperties"].includes(action);
        }

        if (view === "work-entries" || view === "reports") {
          return ["getEntities", "getEmployees", "getProperties", "getWorkEntries"].includes(action);
        }

        return false;
      };

      const [
        employeeData,
        entityData,
        propertyData,
        entryData,
        dashboardData,
      ] = await Promise.all([
        shouldLoad(initialView, "getEmployees")
          ? loadAction("employees", "getEmployees")
          : Promise.resolve(null),
        shouldLoad(initialView, "getEntities")
          ? loadAction("entities", "getEntities")
          : Promise.resolve(null),
        shouldLoad(initialView, "getProperties")
          ? loadAction("properties", "getProperties")
          : Promise.resolve(null),
        shouldLoad(initialView, "getWorkEntries")
          ? loadAction("work entries", "getWorkEntries")
          : Promise.resolve(null),
        shouldLoad(initialView, "getDashboard")
          ? loadAction("dashboard", "getDashboard")
          : Promise.resolve(null),
      ]);

      const nextEmployees = employeeData
        ? normalizeEmployees(employeeData)
        : employees;
      const nextEntities = entityData ? normalizeEntities(entityData) : entities;
      const entityRecord =
        entityData && typeof entityData === "object"
          ? (entityData as Record<string, unknown>)
          : {};
      const hasEntityCollection =
        "entities" in entityRecord || "Entities" in entityRecord;
      const backendMessage =
        typeof entityRecord.message === "string" ? entityRecord.message : "";
      setEntityBackendNotice(
        !hasEntityCollection && backendMessage
          ? `The backend responded, but did not return an Entities list. Deploy getEntities/addEntity/updateEntity/deleteEntity support before entity records can be saved. Backend message: ${backendMessage}`
          : "",
      );
      const nextProperties = propertyData
        ? normalizeProperties(propertyData, nextEntities)
        : properties;
      const nextEntries = entryData
        ? normalizeWorkEntries(
            entryData,
            nextEmployees,
            nextProperties,
            nextEntities,
          )
        : entries;

      setEmployees(nextEmployees);
      setEntities(nextEntities);
      setProperties(nextProperties);
      setEntries(nextEntries);
      setDashboardStats(dashboardData ? normalizeDashboard(dashboardData) : {});

      const usefulDashboardData =
        initialView !== "dashboard" ||
        dashboardData ||
        employeeData ||
        entityData ||
        propertyData ||
        entryData;
      const criticalActions =
        initialView === "dashboard"
          ? usefulDashboardData
            ? []
            : [
                "getDashboard",
                "getEmployees",
                "getEntities",
                "getProperties",
                "getWorkEntries",
              ]
          : initialView === "entities"
            ? ["getEntities"]
            : initialView === "employees"
              ? ["getEmployees"]
              : initialView === "properties" || initialView === "property-detail"
                ? ["getProperties"]
                : initialView === "log-work"
                  ? ["getEmployees", "getProperties"]
                  : initialView === "work-entries" || initialView === "reports"
                    ? ["getWorkEntries"]
                    : [];
      const criticalFailures = failures.filter((failure) =>
        criticalActions.includes(failure.action),
      );

      if (criticalFailures.length > 0) {
        const message = `Some data could not load. ${criticalFailures
          .map((failure) => failure.message)
          .join(" ")}`;
        setBackendError(message);
        notify(message, "error");
      }
    } catch (error) {
      const message = errorMessage(error);
      setBackendError(message);
      notify(message, "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshData();
    }, 0);

    return () => window.clearTimeout(timer);
    // Initial backend load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const analytics = useMemo(() => {
    return deriveDashboard(dashboardStats, employees, properties, entries, entities);
  }, [dashboardStats, employees, properties, entries, entities]);

  async function addEntity(entity: EntityForm) {
    await postAction("addEntity", {
      entityName: entity.name.trim(),
      name: entity.name.trim(),
      active: entity.active,
    });
    notify("Entity added.");
    await refreshData({ quiet: true, forceFresh: true });
  }

  async function updateEntity(id: string, entity: EntityForm) {
    await postAction("updateEntity", {
      id,
      entityId: id,
      entityName: entity.name.trim(),
      name: entity.name.trim(),
      active: entity.active,
    });
    notify("Entity updated.");
    await refreshData({ quiet: true, forceFresh: true });
  }

  async function deleteEntity(entity: Entity) {
    const assignedProperties = properties.filter(
      (property) => property.entityId === entity.id,
    );

    if (assignedProperties.length > 0) {
      throw new Error(
        `${entity.name} has ${assignedProperties.length} assigned propert${
          assignedProperties.length === 1 ? "y" : "ies"
        }. Reassign those properties before deleting, or mark the entity inactive.`,
      );
    }

    await postAction("deleteEntity", {
      id: entity.id,
      entityId: entity.id,
    });
    notify("Entity deleted.");
    await refreshData({ quiet: true, forceFresh: true });
  }

  async function addEmployee(employee: EmployeeForm) {
    await postAction("addEmployee", {
      name: employee.name.trim(),
      hourlyRate: Number(employee.hourlyRate),
      active: employee.active,
    });
    notify("Employee added.");
    await refreshData({ quiet: true, forceFresh: true });
  }

  async function updateEmployee(id: string, employee: EmployeeForm) {
    await postAction("updateEmployee", {
      id,
      employeeId: id,
      name: employee.name.trim(),
      hourlyRate: Number(employee.hourlyRate),
      active: employee.active,
    });
    notify("Employee updated.");
    await refreshData({ quiet: true, forceFresh: true });
  }

  async function deleteEmployee(employee: Employee) {
    await postAction("deleteEmployee", {
      id: employee.id,
      employeeId: employee.id,
    });
    notify("Employee deleted.");
    await refreshData({ quiet: true, forceFresh: true });
  }

  async function addProperty(property: PropertyForm) {
    await postAction("addProperty", {
      name: property.name.trim(),
      propertyName: property.name.trim(),
      address: property.address.trim(),
      entityId: property.entityId,
      entityName:
        entities.find((entity) => entity.id === property.entityId)?.name ?? "",
      active: property.active,
    });
    notify("Property added.");
    await refreshData({ quiet: true, forceFresh: true });
  }

  async function updateProperty(id: string, property: PropertyForm) {
    await postAction("updateProperty", {
      id,
      propertyId: id,
      name: property.name.trim(),
      propertyName: property.name.trim(),
      address: property.address.trim(),
      entityId: property.entityId,
      entityName:
        entities.find((entity) => entity.id === property.entityId)?.name ?? "",
      active: property.active,
    });
    notify("Property updated.");
    await refreshData({ quiet: true, forceFresh: true });
  }

  async function deleteProperty(property: PropertySite) {
    await postAction("deleteProperty", {
      id: property.id,
      propertyId: property.id,
    });
    notify("Property deleted.");
    await refreshData({ quiet: true, forceFresh: true });
  }

  async function addWorkEntry(payload: WorkEntryPayload) {
    const property = properties.find((item) => item.id === payload.propertyId);
    const result = await postAction<unknown>("addWorkEntry", {
      ...payload,
      photoLinks: payload.photos,
      photoUrls: payload.photos,
      "Photo Links": payload.photos,
      workPerformed: payload.description,
      entityId: property?.entityId ?? payload.entityId ?? "",
      entityName: property?.entityName ?? payload.entityName ?? "",
    });
    const [savedEntry] = normalizeWorkEntries(result, employees, properties, entities);
    notify(
      savedEntry?.laborCost
        ? `Work entry saved. Labor cost: ${currency(savedEntry.laborCost)}.`
        : "Work entry saved.",
    );
    await refreshData({ quiet: true, forceFresh: true });
    return savedEntry;
  }

  async function updateWorkEntry(id: string, payload: WorkEntryPayload) {
    const property = properties.find((item) => item.id === payload.propertyId);
    await postAction("updateWorkEntry", {
      id,
      entryId: id,
      ...payload,
      photoLinks: payload.photos,
      photoUrls: payload.photos,
      "Photo Links": payload.photos,
      workPerformed: payload.description,
      entityId:
        property?.entityId ?? payload.entityId,
      entityName:
        property?.entityName ?? payload.entityName,
    });
    notify("Work entry updated.");
    await refreshData({ quiet: true, forceFresh: true });
  }

  async function deleteWorkEntry(entry: WorkEntry) {
    await postAction("deleteWorkEntry", {
      id: entry.id,
      entryId: entry.id,
    });
    notify("Work entry deleted.", "info");
    await refreshData({ quiet: true, forceFresh: true });
  }

  async function uploadPhoto(file: File) {
    const data = await fileToBase64(file);
    const result = await postAction<unknown>("uploadPhoto", {
      fileName: file.name,
      name: file.name,
      mimeType: file.type,
      contentType: file.type,
      data,
      base64: data,
    });
    const url = normalizeUploadPhotoResponse(result);
    if (!url) {
      throw new Error(`Photo upload did not return a URL for ${file.name}.`);
    }
    return url;
  }

  const hasBackendIssue = Boolean(backendError);
  const showInitialEmpty = !loading && !hasBackendIssue;

  const pageContent = (() => {
    if (loading) {
      return <LoadingState />;
    }

    return (
      <>
        {backendError && (
          <ErrorBanner
            message={backendError}
            onRetry={() => void refreshData({ forceFresh: true })}
          />
        )}
        {initialView === "dashboard" && (
          <DashboardView
            analytics={analytics}
            entities={entities}
            employees={employees}
            properties={properties}
            entries={entries}
            empty={showInitialEmpty && entries.length === 0}
          />
        )}
        {initialView === "entities" && (
          <EntitiesView
            entities={entities}
            properties={properties}
            entries={entries}
            employees={employees}
            addEntity={addEntity}
            updateEntity={updateEntity}
            deleteEntity={deleteEntity}
            notify={notify}
            disabled={hasBackendIssue}
            backendNotice={entityBackendNotice}
          />
        )}
        {initialView === "log-work" && (
          <LogWorkView
            entities={entities}
            employees={employees}
            properties={properties}
            addEntry={addWorkEntry}
            uploadPhoto={uploadPhoto}
            disabled={hasBackendIssue}
          />
        )}
        {initialView === "employees" && (
          <EmployeesView
            employees={employees}
            entries={entries}
            addEmployee={addEmployee}
            updateEmployee={updateEmployee}
            deleteEmployee={deleteEmployee}
            notify={notify}
            disabled={hasBackendIssue}
          />
        )}
        {initialView === "properties" && (
          <PropertiesView
            entities={entities}
            employees={employees}
            properties={properties}
            entries={entries}
            addProperty={addProperty}
            updateProperty={updateProperty}
            deleteProperty={deleteProperty}
            notify={notify}
            disabled={hasBackendIssue}
          />
        )}
        {initialView === "property-detail" && (
          <PropertyDetailView
            entities={entities}
            employees={employees}
            properties={properties}
            entries={entries}
            propertyId={propertyId}
          />
        )}
        {initialView === "work-entries" && (
          <WorkEntriesView
            entities={entities}
            employees={employees}
            properties={properties}
            entries={entries}
            updateWorkEntry={updateWorkEntry}
            deleteWorkEntry={deleteWorkEntry}
            uploadPhoto={uploadPhoto}
            notify={notify}
            disabled={hasBackendIssue}
          />
        )}
        {initialView === "reports" && (
          <ReportsView
            entities={entities}
            employees={employees}
            properties={properties}
            entries={entries}
            notify={notify}
          />
        )}
      </>
    );
  })();

  const mainTitle =
    initialView === "dashboard"
      ? "Labor Command Center"
      : initialView === "entities"
        ? "Entities"
      : initialView === "log-work"
        ? "Log Work"
        : initialView === "employees"
          ? "Employees"
          : initialView === "properties"
            ? "Properties"
            : initialView === "property-detail"
              ? "Property Detail"
              : initialView === "work-entries"
                ? "Work Entries"
                : initialView === "reports"
                  ? "Reports"
                  : "Internal Login";

  if (initialView === "login") {
    return <LoginView notify={notify} toasts={toasts} />;
  }

  return (
    <div className="min-h-screen bg-[#f4f7f4] text-[#17201a]">
      <AppSidebar activeView={initialView} />
      <div className="min-h-screen lg:pl-72">
        <MobileHeader activeView={initialView} />
        <header className="border-b border-black/5 bg-white/82 px-4 py-4 shadow-sm backdrop-blur md:px-6 lg:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#56705d]">
                TR Properties Labor Tracker
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-[#17201a] md:text-3xl">
                {mainTitle}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                label={
                  backendError
                    ? "Backend needs attention"
                    : refreshing
                      ? "Refreshing"
                      : "Google Apps Script"
                }
                tone={backendError ? "amber" : "green"}
              />
              <StatusPill label={`${analytics.activeEmployees} active workers`} />
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  void refreshData({ quiet: true, forceFresh: true })
                }
                disabled={refreshing || loading}
              >
                Refresh
              </button>
              <Link
                href="/log-work"
                className="rounded-lg bg-[#184b32] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0f3825]"
              >
                New entry
              </Link>
            </div>
          </div>
        </header>

        <main className="px-4 py-5 md:px-6 lg:px-8">{pageContent}</main>
      </div>
      <ToastStack toasts={toasts} />
    </div>
  );
}

function AppSidebar({ activeView }: { activeView: View }) {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-black/5 bg-[#0f2418] text-white lg:block">
      <div className="flex h-full flex-col">
        <div className="border-b border-white/10 px-6 py-6">
          <Link href="/" className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-[#c7a75d] text-lg font-black text-[#102217]">
              TR
            </div>
            <div>
              <p className="text-lg font-semibold">TR Properties</p>
              <p className="text-sm text-white/60">Labor operations</p>
            </div>
          </Link>
        </div>
        <nav className="flex-1 space-y-1 px-4 py-5">
          {navItems.map((item) => (
            <Link
              key={item.view}
              href={item.href}
              className={classNames(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                activeView === item.view
                  ? "bg-white text-[#102217] shadow-sm"
                  : "text-white/74 hover:bg-white/10 hover:text-white",
              )}
            >
              <span
                className={classNames(
                  "grid h-8 w-8 place-items-center rounded-md text-xs font-bold",
                  activeView === item.view
                    ? "bg-[#e9f1e8] text-[#184b32]"
                    : "bg-white/10 text-white/80",
                )}
              >
                {item.symbol}
              </span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="m-4 rounded-lg border border-white/10 bg-white/8 p-4">
          <p className="text-sm font-semibold">Shared internal access</p>
          <p className="mt-1 text-sm leading-6 text-white/62">
            Workers do not have accounts. Management records activity manually.
          </p>
          <Link
            href="/api/logout"
            className="mt-4 inline-flex rounded-md border border-white/15 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Sign out
          </Link>
        </div>
      </div>
    </aside>
  );
}

function MobileHeader({ activeView }: { activeView: View }) {
  return (
    <div className="border-b border-black/5 bg-[#0f2418] px-4 py-3 text-white lg:hidden">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#c7a75d] text-sm font-black text-[#102217]">
            TR
          </span>
          <span className="font-semibold">Labor Tracker</span>
        </Link>
        <Link
          href="/api/logout"
          className="rounded-md border border-white/15 px-3 py-2 text-sm font-semibold"
        >
          Sign out
        </Link>
      </div>
      <nav className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {navItems.map((item) => (
          <Link
            key={item.view}
            href={item.href}
            className={classNames(
              "shrink-0 rounded-md px-3 py-2 text-sm font-medium transition",
              activeView === item.view
                ? "bg-white text-[#102217]"
                : "bg-white/10 text-white/75",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function DashboardView({
  analytics,
  entities,
  employees,
  properties,
  entries,
  empty,
}: {
  analytics: DashboardStats;
  entities: Entity[];
  employees: Employee[];
  properties: PropertySite[];
  entries: WorkEntry[];
  empty: boolean;
}) {
  const recentEntries = [...entries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  const byWorker = employees
    .map((employee) => ({
      employee,
      hours: entries
        .filter((entry) => entry.employeeId === employee.id)
        .reduce((sum, entry) => sum + entry.hours, 0),
    }))
    .sort((a, b) => b.hours - a.hours);
  const byProperty = properties
    .map((property) => ({
      property,
      hours: entries
        .filter((entry) => entry.propertyId === property.id)
        .reduce((sum, entry) => sum + entry.hours, 0),
    }))
    .sort((a, b) => b.hours - a.hours);
  const byEntity = entityLaborRows(entities, properties, entries, employees);

  return (
    <div className="space-y-6">
      {empty && (
        <EmptyState
          title="No backend work entries yet"
          message="Once entries are added in Google Sheets through the Apps Script backend, dashboard charts and recent activity will populate here."
        />
      )}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Total hours this week" value={analytics.weekHours} />
        <MetricCard label="Total hours this month" value={analytics.monthHours} />
        <MetricCard
          label="Labor cost this week"
          value={currency(analytics.weekCost)}
          accent="gold"
        />
        <MetricCard
          label="Labor cost this month"
          value={currency(analytics.monthCost)}
          accent="gold"
        />
        <MetricCard
          label="Active workers"
          value={analytics.activeEmployees}
          accent="blue"
        />
        <MetricCard
          label="Active properties"
          value={analytics.activeProperties}
          accent="green"
        />
        <MetricCard
          label="Active entities"
          value={analytics.activeEntities}
          accent="blue"
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Panel
          title="Recent Work Entries"
          action={<Link href="/work-entries">View all</Link>}
        >
          <EntryList
            entries={recentEntries}
            employees={employees}
            properties={properties}
          />
        </Panel>
        <Panel
          title="Active Properties"
          action={<Link href="/properties">Manage</Link>}
        >
          <div className="space-y-3">
            {properties
              .filter((property) => property.active)
              .map((property) => {
                const propertyEntries = entries.filter(
                  (entry) => entry.propertyId === property.id,
                );
                const hours = propertyEntries.reduce(
                  (sum, entry) => sum + entry.hours,
                  0,
                );
                return (
                  <Link
                    key={property.id}
                    href={`/properties/${property.id}`}
                    className="block rounded-lg border border-[#dfe7dc] bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#b9cdb8] hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[#17201a]">
                          {property.name}
                        </p>
                        <p className="mt-1 text-sm text-[#677568]">
                          {property.address}
                        </p>
                      </div>
                      <span className="rounded-md bg-[#e9f1e8] px-2 py-1 text-xs font-semibold text-[#184b32]">
                        {hours}h
                      </span>
                    </div>
                  </Link>
                );
              })}
          </div>
        </Panel>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Panel title="Labor by Entity">
          {byEntity.length === 0 ? (
            <EmptyState
              title="No entities returned"
              message="Entity-level labor totals will appear once entities are loaded and properties are assigned."
            />
          ) : (
            <div className="space-y-3">
              {byEntity.map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg border border-[#dfe7dc] bg-[#fbfcfa] p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-[#17201a]">{row.label}</p>
                      <p className="mt-1 text-sm text-[#677568]">
                        {row.properties.length} properties
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="font-semibold text-[#184b32]">{row.value}h</p>
                      <p className="text-[#677568]">{currency(row.cost)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Hours by Worker">
          <BarList
            rows={byWorker.map(({ employee, hours }) => ({
              label: employee.name,
              value: hours,
              sublabel: employee.active ? "Active" : "Inactive",
            }))}
          />
        </Panel>
        <Panel title="Hours by Property">
          <BarList
            rows={byProperty.map(({ property, hours }) => ({
              label: property.name,
              value: hours,
              sublabel: property.active ? "Active" : "Inactive",
            }))}
          />
        </Panel>
      </section>
    </div>
  );
}

function EntitiesView({
  entities,
  properties,
  entries,
  employees,
  addEntity,
  updateEntity,
  deleteEntity,
  notify,
  disabled,
  backendNotice,
}: {
  entities: Entity[];
  properties: PropertySite[];
  entries: WorkEntry[];
  employees: Employee[];
  addEntity: (entity: EntityForm) => Promise<void>;
  updateEntity: (id: string, entity: EntityForm) => Promise<void>;
  deleteEntity: (entity: Entity) => Promise<void>;
  notify: (message: string, kind?: Toast["kind"]) => void;
  disabled: boolean;
  backendNotice: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<EntityForm>({
    name: "",
    active: true,
  });

  function startEdit(entity: Entity) {
    setEditingId(entity.id);
    setForm({
      name: entity.name,
      active: entity.active,
    });
  }

  function reset() {
    setEditingId(null);
    setForm({ name: "", active: true });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      if (editingId) {
        await updateEntity(editingId, form);
      } else {
        await addEntity(form);
      }
      reset();
    } catch (submitError) {
      const message = errorMessage(submitError);
      setError(message);
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(entity: Entity) {
    const propertyCount = properties.filter(
      (property) => property.entityId === entity.id,
    ).length;
    const message =
      propertyCount > 0
        ? `${entity.name} has ${propertyCount} assigned propert${
            propertyCount === 1 ? "y" : "ies"
          }. Reassign those properties before deleting, or mark the entity inactive.`
        : "";

    if (message) {
      setError(message);
      notify(message, "error");
      return;
    }

    const confirmed = window.confirm(`Delete ${entity.name}?`);
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await deleteEntity(entity);
    } catch (deleteError) {
      const nextMessage = errorMessage(deleteError);
      setError(nextMessage);
      notify(nextMessage, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[390px_1fr]">
      <Panel title={editingId ? "Edit Entity" : "Add Entity"}>
        {backendNotice && <InlineError message={backendNotice} />}
        {error && <InlineError message={error} />}
        <form className="grid gap-4" onSubmit={submit}>
          <FormField label="Entity name">
            <input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              className="input"
              placeholder="TR Properties LLC"
              disabled={disabled || saving}
              required
            />
          </FormField>
          <label className="flex items-center justify-between rounded-lg border border-[#dfe7dc] bg-white px-3 py-3 text-sm font-semibold">
            Active entity
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) =>
                setForm((current) => ({ ...current, active: event.target.checked }))
              }
              className="h-5 w-5 accent-[#184b32]"
              disabled={disabled || saving}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={disabled || saving}
            >
              {saving ? "Saving..." : editingId ? "Save changes" : "Add entity"}
            </button>
            {editingId && (
              <button
                type="button"
                className="btn-secondary"
                onClick={reset}
                disabled={saving}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </Panel>

      <Panel title="Entity Register">
        {backendNotice && entities.length > 0 && (
          <InlineError message={backendNotice} />
        )}
        {entities.length === 0 ? (
          <EmptyState
            title="No entities returned"
            message="Entities from the Google Apps Script backend will appear here. Existing unassigned properties can be assigned once an entity is added."
          />
        ) : (
          <ResponsiveTable
            headers={[
              "Name",
              "Active",
              "Properties",
              "Total hours",
              "Labor cost",
              "Actions",
            ]}
          >
            {entities.map((entity) => {
              const entityProperties = properties.filter(
                (property) => property.entityId === entity.id,
              );
              const entityEntries = entries.filter(
                (entry) => getEntryEntityId(entry, properties) === entity.id,
              );
              const hours = entityEntries.reduce(
                (sum, entry) => sum + entry.hours,
                0,
              );
              const cost = entityEntries.reduce(
                (sum, entry) => sum + entryCost(entry, employees),
                0,
              );

              return (
                <tr key={entity.id}>
                  <td>
                    <div className="font-semibold text-[#17201a]">
                      {entity.name}
                    </div>
                  </td>
                  <td>
                    <StatusPill
                      label={entity.active ? "Active" : "Inactive"}
                      tone={entity.active ? "green" : "gray"}
                    />
                  </td>
                  <td>{entityProperties.length}</td>
                  <td>{hours}</td>
                  <td>{currency(cost)}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="table-action"
                        type="button"
                        onClick={() => startEdit(entity)}
                        disabled={disabled || saving}
                      >
                        Edit
                      </button>
                      <button
                        className="table-action-danger"
                        type="button"
                        onClick={() => void remove(entity)}
                        disabled={disabled || saving}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </ResponsiveTable>
        )}
      </Panel>
    </div>
  );
}

function LogWorkView({
  entities,
  employees,
  properties,
  addEntry,
  uploadPhoto,
  disabled,
}: {
  entities: Entity[];
  employees: Employee[];
  properties: PropertySite[];
  addEntry: (entry: WorkEntryPayload) => Promise<WorkEntry | undefined>;
  uploadPhoto: (file: File) => Promise<string>;
  disabled: boolean;
}) {
  const activeEmployees = employees.filter((employee) => employee.active);
  const activeProperties = properties.filter((property) => property.active);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedCost, setSavedCost] = useState<number | null>(null);
  const [form, setForm] = useState<EntryForm>({
    employeeId: activeEmployees[0]?.id ?? "",
    propertyId: activeProperties[0]?.id ?? "",
    date: today,
    hours: "",
    description: "",
    notes: "",
  });
  const selectedEmployeeId = form.employeeId || activeEmployees[0]?.id || "";
  const selectedPropertyId = form.propertyId || activeProperties[0]?.id || "";
  const selectedProperty = getProperty(properties, selectedPropertyId);
  const selectedEntity =
    getPropertyEntity(selectedProperty, entities)?.name ??
    selectedProperty?.entityName ??
    "Unassigned";

  function updateField<K extends keyof EntryForm>(key: K, value: EntryForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFiles(Array.from(event.target.files ?? []));
  }

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hours = Number(form.hours);

    if (!selectedEmployeeId || !selectedPropertyId || !form.date || hours <= 0) {
      return;
    }

    setSaving(true);
    setError("");
    setSavedCost(null);

    try {
      const photoUrls = [];
      for (const file of selectedFiles) {
        photoUrls.push(await uploadPhoto(file));
      }

      const savedEntry = await addEntry({
        employeeId: selectedEmployeeId,
        propertyId: selectedPropertyId,
        entityId: selectedProperty?.entityId,
        entityName: selectedProperty?.entityName,
        date: form.date,
        hours,
        description: form.description.trim(),
        notes: form.notes.trim(),
        photos: photoUrls,
      });
      setSavedCost(savedEntry?.laborCost ?? null);
      setSelectedFiles([]);
      setForm((current) => ({
        ...current,
        hours: "",
        description: "",
        notes: "",
      }));
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Panel title="Manual Work Entry">
        {activeEmployees.length === 0 || activeProperties.length === 0 ? (
          <EmptyState
            title="Employees and properties are required"
            message="Load or add at least one active employee and one active property before logging work."
          />
        ) : null}
        {error && <InlineError message={error} />}
        {savedCost !== null && (
          <div className="mb-4 rounded-lg bg-[#e9f1e8] px-4 py-3 text-sm font-semibold text-[#184b32]">
            Backend returned labor cost: {currency(savedCost)}
          </div>
        )}
        <form className="grid gap-5" onSubmit={submitEntry}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2 text-sm font-semibold text-[#3b473e]">
              <label htmlFor="work-entry-employee">Worker</label>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <select
                  id="work-entry-employee"
                  value={selectedEmployeeId}
                  onChange={(event) => updateField("employeeId", event.target.value)}
                  className="input"
                  disabled={disabled || saving}
                  required
                >
                  {activeEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
                <Link
                  href="/employees"
                  className="btn-secondary whitespace-nowrap px-3"
                >
                  Add employee
                </Link>
              </div>
            </div>
            <div className="grid gap-2 text-sm font-semibold text-[#3b473e]">
              <label htmlFor="work-entry-property">Property or job site</label>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <select
                  id="work-entry-property"
                  value={selectedPropertyId}
                  onChange={(event) => updateField("propertyId", event.target.value)}
                  className="input"
                  disabled={disabled || saving}
                  required
                >
                  {activeProperties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </select>
                <Link
                  href="/properties"
                  className="btn-secondary whitespace-nowrap px-3"
                >
                  Add property
                </Link>
              </div>
              <span className="text-xs font-semibold text-[#677568]">
                Entity: {selectedEntity}
              </span>
            </div>
            <FormField label="Date">
              <input
                type="date"
                value={form.date}
                onChange={(event) => updateField("date", event.target.value)}
                className="input"
                disabled={disabled || saving}
                required
              />
            </FormField>
            <FormField label="Hours worked">
              <input
                type="number"
                min="0.25"
                step="0.25"
                value={form.hours}
                onChange={(event) => updateField("hours", event.target.value)}
                className="input"
                placeholder="7.5"
                disabled={disabled || saving}
                required
              />
            </FormField>
          </div>
          <FormField label="Description of work performed">
            <textarea
              value={form.description}
              onChange={(event) => updateField("description", event.target.value)}
              className="input min-h-28 resize-y"
              placeholder="Example: repaired trim, patched drywall, cleaned staging area"
              disabled={disabled || saving}
              required
            />
          </FormField>
          <FormField label="Photos">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#a9b9a9] bg-[#f7faf6] px-4 py-8 text-center transition hover:border-[#184b32] hover:bg-white">
              <span className="text-sm font-semibold text-[#184b32]">
                Select multiple photos
              </span>
              <span className="mt-1 text-sm text-[#677568]">
                JPG, PNG, and HEIC files upload before the work entry is saved.
              </span>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handlePhotoChange}
                className="sr-only"
                disabled={disabled || saving}
              />
            </label>
            {selectedFiles.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedFiles.map((file) => (
                  <PhotoChip key={`${file.name}-${file.size}`} label={file.name} />
                ))}
              </div>
            )}
          </FormField>
          <FormField label="Optional notes">
            <textarea
              value={form.notes}
              onChange={(event) => updateField("notes", event.target.value)}
              className="input min-h-20 resize-y"
              placeholder="Materials, blockers, weather, follow-up needs"
              disabled={disabled || saving}
            />
          </FormField>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="reset"
              className="btn-secondary"
              disabled={saving}
              onClick={() => {
                setSelectedFiles([]);
                setError("");
              }}
            >
              Clear
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={
                disabled ||
                saving ||
                activeEmployees.length === 0 ||
                activeProperties.length === 0
              }
            >
              {saving ? "Saving..." : "Save work entry"}
            </button>
          </div>
        </form>
      </Panel>
      <Panel title="Fast Entry Notes">
        <div className="space-y-4 text-sm leading-6 text-[#566258]">
          <p>
            This screen is intentionally built for management entry after crews
            report in. Only active workers and active properties appear in the
            main selectors.
          </p>
          <div className="rounded-lg bg-[#f0f5ed] p-4">
            <p className="font-semibold text-[#17201a]">Current backend setup</p>
            <p className="mt-1">
              {activeEmployees.length} active workers and {activeProperties.length}{" "}
              active job sites are available.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function EmployeesView({
  employees,
  entries,
  addEmployee,
  updateEmployee,
  deleteEmployee,
  notify,
  disabled,
}: {
  employees: Employee[];
  entries: WorkEntry[];
  addEmployee: (employee: EmployeeForm) => Promise<void>;
  updateEmployee: (id: string, employee: EmployeeForm) => Promise<void>;
  deleteEmployee: (employee: Employee) => Promise<void>;
  notify: (message: string, kind?: Toast["kind"]) => void;
  disabled: boolean;
}) {
  const editFormRef = useRef<HTMLDivElement>(null);
  const hourlyRateInputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<EmployeeForm>({
    name: "",
    hourlyRate: "",
    active: true,
  });

  function startEdit(employee: Employee) {
    setEditingId(employee.id);
    setForm({
      name: employee.name,
      hourlyRate: String(employee.hourlyRate),
      active: employee.active,
    });

    hourlyRateInputRef.current?.focus();
    window.requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 1279px)").matches) {
        editFormRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    });
  }

  function reset() {
    setEditingId(null);
    setForm({ name: "", hourlyRate: "", active: true });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hourlyRate = Number(form.hourlyRate);

    if (!form.name.trim() || hourlyRate <= 0) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      if (editingId) {
        await updateEmployee(editingId, form);
      } else {
        await addEmployee(form);
      }
      reset();
    } catch (submitError) {
      const message = errorMessage(submitError);
      setError(message);
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(employee: Employee) {
    const confirmed = window.confirm(
      `Delete ${employee.name}? Their historical work entries will remain.`,
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await deleteEmployee(employee);
    } catch (deleteError) {
      const message = errorMessage(deleteError);
      setError(message);
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[390px_1fr]">
      <div ref={editFormRef} className="scroll-mt-24">
        <Panel title={editingId ? "Edit Employee" : "Add Employee"}>
          {error && <InlineError message={error} />}
          <form className="grid gap-4" onSubmit={submit}>
            <FormField label="Employee name">
              <input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                className="input"
                placeholder="Full name"
                disabled={disabled || saving}
                required
              />
            </FormField>
            <FormField label="Hourly rate">
              <input
                ref={hourlyRateInputRef}
                type="number"
                min="0.01"
                step="any"
                value={form.hourlyRate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    hourlyRate: event.target.value,
                  }))
                }
                className="input"
                placeholder="32.50"
                disabled={disabled || saving}
                required
              />
            </FormField>
            <label className="flex items-center justify-between rounded-lg border border-[#dfe7dc] bg-white px-3 py-3 text-sm font-semibold">
              Active employee
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    active: event.target.checked,
                  }))
                }
                className="h-5 w-5 accent-[#184b32]"
                disabled={disabled || saving}
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                className="btn-primary flex-1"
                disabled={disabled || saving}
              >
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Save changes"
                    : "Add employee"}
              </button>
              {editingId && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={reset}
                  disabled={saving}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </Panel>
      </div>
      <Panel title="Employee Roster">
        {employees.length === 0 ? (
          <EmptyState
            title="No employees returned"
            message="Employees loaded from the Google Apps Script backend will appear here."
          />
        ) : (
        <ResponsiveTable
          headers={[
            "Employee",
            "Status",
            "Rate",
            "Total hours",
            "Estimated cost",
            "Actions",
          ]}
        >
          {employees.map((employee) => {
            const employeeEntries = entries.filter(
              (entry) => entry.employeeId === employee.id,
            );
            const hours = employeeEntries.reduce(
              (sum, entry) => sum + entry.hours,
              0,
            );
            return (
              <tr key={employee.id}>
                <td>
                  <div className="font-semibold text-[#17201a]">
                    {employee.name}
                  </div>
                </td>
                <td>
                  <StatusPill
                    label={employee.active ? "Active" : "Inactive"}
                    tone={employee.active ? "green" : "gray"}
                  />
                </td>
                <td>{hourlyRateCurrency(employee.hourlyRate)}/hr</td>
                <td>{hours}</td>
                <td>{currency(hours * employee.hourlyRate)}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="table-action"
                      type="button"
                      onClick={() => startEdit(employee)}
                      disabled={disabled || saving}
                    >
                      Edit
                    </button>
                    <button
                      className="table-action-danger"
                      type="button"
                      onClick={() => void remove(employee)}
                      disabled={disabled || saving}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </ResponsiveTable>
        )}
      </Panel>
    </div>
  );
}

function PropertiesView({
  entities,
  employees,
  properties,
  entries,
  addProperty,
  updateProperty,
  deleteProperty,
  notify,
  disabled,
}: {
  entities: Entity[];
  employees: Employee[];
  properties: PropertySite[];
  entries: WorkEntry[];
  addProperty: (property: PropertyForm) => Promise<void>;
  updateProperty: (id: string, property: PropertyForm) => Promise<void>;
  deleteProperty: (property: PropertySite) => Promise<void>;
  notify: (message: string, kind?: Toast["kind"]) => void;
  disabled: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activeEntities = entities.filter((entity) => entity.active);
  const defaultEntityId = activeEntities[0]?.id ?? "";
  const [form, setForm] = useState<PropertyForm>({
    name: "",
    address: "",
    entityId: defaultEntityId,
    active: true,
  });
  const selectedFormEntityId = form.entityId || defaultEntityId;

  function reset() {
    setEditingId(null);
    setForm({ name: "", address: "", entityId: defaultEntityId, active: true });
  }

  function startEdit(property: PropertySite) {
    setEditingId(property.id);
    setForm({
      name: property.name,
      address: property.address,
      entityId: property.entityId ?? defaultEntityId,
      active: property.active,
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim() || !form.address.trim() || !selectedFormEntityId) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      if (editingId) {
        await updateProperty(editingId, {
          ...form,
          entityId: selectedFormEntityId,
        });
      } else {
        await addProperty({ ...form, entityId: selectedFormEntityId });
      }
      reset();
    } catch (submitError) {
      const message = errorMessage(submitError);
      setError(message);
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(property: PropertySite) {
    const confirmed = window.confirm(
      `Delete ${property.name}? Work history will remain available.`,
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await deleteProperty(property);
    } catch (deleteError) {
      const message = errorMessage(deleteError);
      setError(message);
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[390px_1fr]">
      <Panel title={editingId ? "Edit Property" : "Add Property"}>
        {error && <InlineError message={error} />}
        <form className="grid gap-4" onSubmit={submit}>
          <FormField label="Property name">
            <input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              className="input"
              placeholder="Property or job site"
              disabled={disabled || saving}
              required
            />
          </FormField>
          <FormField label="Property address">
            <textarea
              value={form.address}
              onChange={(event) =>
                setForm((current) => ({ ...current, address: event.target.value }))
              }
              className="input min-h-24 resize-y"
              placeholder="Street, city, state"
              disabled={disabled || saving}
              required
            />
          </FormField>
          <FormField label="Entity">
            <select
              value={selectedFormEntityId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  entityId: event.target.value,
                }))
              }
              className="input"
              disabled={disabled || saving || activeEntities.length === 0}
              required
            >
              {activeEntities.length === 0 ? (
                <option value="">Add an active entity first</option>
              ) : (
                activeEntities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))
              )}
            </select>
          </FormField>
          <label className="flex items-center justify-between rounded-lg border border-[#dfe7dc] bg-white px-3 py-3 text-sm font-semibold">
            Active property
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) =>
                setForm((current) => ({ ...current, active: event.target.checked }))
              }
              className="h-5 w-5 accent-[#184b32]"
              disabled={disabled || saving}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={disabled || saving || activeEntities.length === 0}
            >
              {saving ? "Saving..." : editingId ? "Save changes" : "Add property"}
            </button>
            {editingId && (
              <button
                type="button"
                className="btn-secondary"
                onClick={reset}
                disabled={saving}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </Panel>

      <div className="grid gap-4">
        {properties.length === 0 && (
          <EmptyState
            title="No properties returned"
            message="Properties loaded from the Google Apps Script backend will appear here."
          />
        )}
        {properties.map((property) => {
          const propertyEntries = entries.filter(
            (entry) => entry.propertyId === property.id,
          );
          const hours = propertyEntries.reduce((sum, entry) => sum + entry.hours, 0);
          const cost = propertyEntries.reduce(
            (sum, entry) => sum + entryCost(entry, employees),
            0,
          );
          const workerNames = [
            ...new Set(
              propertyEntries
                .map(
                  (entry) =>
                    getEmployee(employees, entry.employeeId)?.name ??
                    entry.employeeName,
                )
                .filter(Boolean),
            ),
          ] as string[];

          return (
            <article
              key={property.id}
              className="rounded-lg border border-[#dfe7dc] bg-white p-5 shadow-sm transition hover:border-[#b9cdb8] hover:shadow-md"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/properties/${property.id}`}
                      className="text-lg font-semibold text-[#17201a] transition hover:text-[#184b32]"
                    >
                      {property.name}
                    </Link>
                    <StatusPill
                      label={property.active ? "Active" : "Inactive"}
                      tone={property.active ? "green" : "gray"}
                    />
                  </div>
                  <p className="mt-1 text-sm text-[#677568]">{property.address}</p>
                  <p className="mt-2 text-sm font-semibold text-[#184b32]">
                    Entity:{" "}
                    {getPropertyEntity(property, entities)?.name ??
                      property.entityName ??
                      "Unassigned"}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {workerNames.length > 0 ? (
                      workerNames.map((name) => (
                        <span
                          key={name}
                          className="rounded-md bg-[#eef3f7] px-2.5 py-1 text-xs font-semibold text-[#31506b]"
                        >
                          {name}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-[#677568]">
                        No work entries yet
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:min-w-72">
                  <MiniMetric label="Hours" value={hours} />
                  <MiniMetric label="Labor cost" value={currency(cost)} />
                </div>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Link href={`/properties/${property.id}`} className="btn-secondary">
                  View detail
                </Link>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => startEdit(property)}
                  disabled={disabled || saving}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => void remove(property)}
                  disabled={disabled || saving}
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function PropertyDetailView({
  entities,
  employees,
  properties,
  entries,
  propertyId,
}: {
  entities: Entity[];
  employees: Employee[];
  properties: PropertySite[];
  entries: WorkEntry[];
  propertyId?: string;
}) {
  const property = properties.find((item) => item.id === propertyId) ?? properties[0];
  if (!property) {
    return (
      <EmptyState
        title="Property not found"
        message="The backend did not return this property. Refresh the properties list or confirm the record exists in Google Sheets."
      />
    );
  }

  const propertyEntries = entries.filter((entry) => entry.propertyId === property.id);
  const propertyEntity =
    getPropertyEntity(property, entities)?.name ?? property.entityName ?? "Unassigned";
  const hours = propertyEntries.reduce((sum, entry) => sum + entry.hours, 0);
  const cost = propertyEntries.reduce(
    (sum, entry) => sum + entryCost(entry, employees),
    0,
  );
  const workers = [
    ...new Set(
      propertyEntries
        .map((entry) => getEmployee(employees, entry.employeeId)?.name ?? entry.employeeName)
        .filter(Boolean),
    ),
  ] as string[];

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[#dfe7dc] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link
              href="/properties"
              className="text-sm font-semibold text-[#56705d] transition hover:text-[#184b32]"
            >
              Back to properties
            </Link>
            <h2 className="mt-3 text-2xl font-semibold text-[#17201a]">
              {property.name}
            </h2>
            <p className="mt-1 text-[#677568]">{property.address}</p>
            <p className="mt-2 text-sm font-semibold text-[#184b32]">
              Entity: {propertyEntity}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusPill
                label={property.active ? "Active" : "Inactive"}
                tone={property.active ? "green" : "gray"}
              />
              <StatusPill label={`${workers.length} workers`} tone="blue" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-96">
            <MiniMetric label="Total labor hours" value={hours} />
            <MiniMetric label="Total labor cost" value={currency(cost)} />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_390px]">
        <Panel title="Recent Activity">
          <EntryList
            entries={[...propertyEntries].sort((a, b) => b.date.localeCompare(a.date))}
            employees={employees}
            properties={properties}
          />
        </Panel>
        <Panel title="Workers On This Property">
          <div className="space-y-3">
            {workers.length === 0 && (
              <p className="text-sm text-[#677568]">No employees recorded yet.</p>
            )}
            {workers.map((name) => (
              <div
                key={name}
                className="flex items-center justify-between rounded-lg border border-[#dfe7dc] bg-white p-3"
              >
                <span className="font-semibold">{name}</span>
                <span className="text-sm text-[#677568]">Recorded work</span>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function WorkEntriesView({
  entities,
  employees,
  properties,
  entries,
  updateWorkEntry,
  deleteWorkEntry,
  uploadPhoto,
  notify,
  disabled,
}: {
  entities: Entity[];
  employees: Employee[];
  properties: PropertySite[];
  entries: WorkEntry[];
  updateWorkEntry: (id: string, entry: WorkEntryPayload) => Promise<void>;
  deleteWorkEntry: (entry: WorkEntry) => Promise<void>;
  uploadPhoto: (file: File) => Promise<string>;
  notify: (message: string, kind?: Toast["kind"]) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editingEntry = entries.find((entry) => entry.id === editingId);

  const filteredEntries = entries
    .filter((entry) => {
      const employee = getEmployee(employees, entry.employeeId);
      const property = getProperty(properties, entry.propertyId);
      const entityName = getEntryEntityName(entry, properties, entities);
      const text =
        `${employee?.name ?? entry.employeeName ?? ""} ${property?.name ?? entry.propertyName ?? ""} ${entityName} ${entry.description} ${entry.notes ?? ""}`.toLowerCase();
      const matchesSearch = text.includes(search.toLowerCase());
      const matchesEmployee =
        employeeFilter === "all" || entry.employeeId === employeeFilter;
      const matchesEntity =
        entityFilter === "all" || getEntryEntityId(entry, properties) === entityFilter;
      const matchesProperty =
        propertyFilter === "all" || entry.propertyId === propertyFilter;
      const matchesStart = !startDate || entry.date >= startDate;
      const matchesEnd = !endDate || entry.date <= endDate;

      return (
        matchesSearch &&
        matchesEmployee &&
        matchesEntity &&
        matchesProperty &&
        matchesStart &&
        matchesEnd
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  async function deleteEntry(entry: WorkEntry) {
    const employeeName =
      getEmployee(employees, entry.employeeId)?.name ??
      entry.employeeName ??
      "this entry";
    const confirmed = window.confirm(`Delete ${employeeName}'s work entry?`);
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await deleteWorkEntry(entry);
    } catch (deleteError) {
      const message = errorMessage(deleteError);
      setError(message);
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id: string, updated: WorkEntryPayload) {
    setSaving(true);
    setError("");

    try {
      await updateWorkEntry(id, updated);
      setEditingId(null);
    } catch (updateError) {
      const message = errorMessage(updateError);
      setError(message);
      notify(message, "error");
      throw updateError;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && <InlineError message={error} />}
      <Panel title="Search and Filter">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="input xl:col-span-2"
            placeholder="Search work, employee, entity, property, notes"
          />
          <select
            value={employeeFilter}
            onChange={(event) => setEmployeeFilter(event.target.value)}
            className="input"
          >
            <option value="all">All employees</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
          <select
            value={entityFilter}
            onChange={(event) => setEntityFilter(event.target.value)}
            className="input"
          >
            <option value="all">All entities</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
            <option value="unassigned">Unassigned</option>
          </select>
          <select
            value={propertyFilter}
            onChange={(event) => setPropertyFilter(event.target.value)}
            className="input"
          >
            <option value="all">All properties</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              aria-label="Start date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="input"
            />
            <input
              aria-label="End date"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="input"
            />
          </div>
        </div>
      </Panel>

      {editingEntry && (
        <EntryEditPanel
          entry={editingEntry}
          entities={entities}
          employees={employees}
          properties={properties}
          uploadPhoto={uploadPhoto}
          onCancel={() => setEditingId(null)}
          onSave={saveEdit}
          saving={saving}
          disabled={disabled}
        />
      )}

      <Panel title={`All Work Entries (${filteredEntries.length})`}>
        {filteredEntries.length === 0 ? (
          <EmptyState
            title="No work entries found"
            message="Backend work entries matching the current filters will appear here."
          />
        ) : (
        <ResponsiveTable
          headers={[
            "Date",
            "Employee",
            "Entity",
            "Property",
            "Hours",
            "Work performed",
            "Photos",
            "Labor cost",
            "Actions",
          ]}
        >
          {filteredEntries.map((entry) => (
            <tr key={entry.id}>
              <td>{shortDate(entry.date)}</td>
              <td>
                {getEmployee(employees, entry.employeeId)?.name ??
                  entry.employeeName ??
                  "Unknown"}
              </td>
              <td>{getEntryEntityName(entry, properties, entities)}</td>
              <td>
                {getProperty(properties, entry.propertyId)?.name ??
                  entry.propertyName ??
                  "Unknown"}
              </td>
              <td>{entry.hours}</td>
              <td className="max-w-md">
                <p className="font-medium text-[#17201a]">{entry.description}</p>
                {entry.notes && (
                  <p className="mt-1 text-sm text-[#677568]">{entry.notes}</p>
                )}
              </td>
              <td>
                <div className="flex flex-wrap gap-1.5">
                  {entry.photos.length > 0 ? (
                    entry.photos.map((photo, index) => (
                      <PhotoChip
                        key={photo}
                        label={`Photo ${index + 1}`}
                        compact
                        href={photo}
                      />
                    ))
                  ) : (
                    <span className="text-sm text-[#7a857c]">None</span>
                  )}
                </div>
              </td>
              <td>{currency(entryCost(entry, employees))}</td>
              <td>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="table-action"
                    onClick={() => setEditingId(entry.id)}
                    disabled={disabled || saving}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="table-action-danger"
                    onClick={() => void deleteEntry(entry)}
                    disabled={disabled || saving}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </ResponsiveTable>
        )}
      </Panel>
    </div>
  );
}

function EntryEditPanel({
  entry,
  entities,
  employees,
  properties,
  uploadPhoto,
  onCancel,
  onSave,
  saving,
  disabled,
}: {
  entry: WorkEntry;
  entities: Entity[];
  employees: Employee[];
  properties: PropertySite[];
  uploadPhoto: (file: File) => Promise<string>;
  onCancel: () => void;
  onSave: (id: string, entry: WorkEntryPayload) => Promise<void>;
  saving: boolean;
  disabled: boolean;
}) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [form, setForm] = useState<EntryForm>({
    employeeId: entry.employeeId,
    propertyId: entry.propertyId,
    date: entry.date,
    hours: String(entry.hours),
    description: entry.description,
    notes: entry.notes ?? "",
  });
  const selectedProperty = getProperty(properties, form.propertyId);
  const selectedEntity =
    getPropertyEntity(selectedProperty, entities)?.name ??
    selectedProperty?.entityName ??
    entry.entityName ??
    "Unassigned";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploading(true);
    setUploadError("");

    try {
      const uploadedPhotos: string[] = [];
      for (const file of selectedFiles) {
        uploadedPhotos.push(await uploadPhoto(file));
      }

      await onSave(entry.id, {
        employeeId: form.employeeId,
        propertyId: form.propertyId,
        entityId: selectedProperty?.entityId ?? entry.entityId,
        entityName: selectedProperty?.entityName ?? entry.entityName,
        date: form.date,
        hours: Number(form.hours),
        description: form.description.trim(),
        notes: form.notes.trim(),
        photos: [...entry.photos, ...uploadedPhotos],
      });
      setSelectedFiles([]);
    } catch (error) {
      setUploadError(errorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  const busy = saving || uploading;

  return (
    <Panel title="Edit Work Entry">
      <form className="grid gap-4 lg:grid-cols-4" onSubmit={submit}>
        <select
          value={form.employeeId}
          onChange={(event) =>
            setForm((current) => ({ ...current, employeeId: event.target.value }))
          }
          className="input"
          disabled={disabled || busy}
        >
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
            </option>
          ))}
        </select>
        <select
          value={form.propertyId}
          onChange={(event) =>
            setForm((current) => ({ ...current, propertyId: event.target.value }))
          }
          className="input"
          disabled={disabled || busy}
        >
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
        <div className="rounded-lg bg-[#f0f5ed] px-3 py-2 text-sm font-semibold text-[#184b32]">
          Entity: {selectedEntity}
        </div>
        <input
          type="date"
          value={form.date}
          onChange={(event) =>
            setForm((current) => ({ ...current, date: event.target.value }))
          }
          className="input"
          disabled={disabled || busy}
        />
        <input
          type="number"
          min="0.25"
          step="0.25"
          value={form.hours}
          onChange={(event) =>
            setForm((current) => ({ ...current, hours: event.target.value }))
          }
          className="input"
          disabled={disabled || busy}
        />
        <textarea
          value={form.description}
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
          }
          className="input min-h-24 resize-y lg:col-span-2"
          disabled={disabled || busy}
        />
        <textarea
          value={form.notes}
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
          }
          className="input min-h-24 resize-y lg:col-span-2"
          disabled={disabled || busy}
        />
        <div className="lg:col-span-4">
          <div className="mb-2 text-sm font-semibold text-[#303b33]">Photos</div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="btn-secondary cursor-pointer">
              Add photos
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={(event) =>
                  setSelectedFiles(Array.from(event.target.files ?? []))
                }
                className="sr-only"
                disabled={disabled || busy}
              />
            </label>
            {selectedFiles.map((file) => (
              <PhotoChip
                key={`${file.name}-${file.size}`}
                label={file.name}
                compact
              />
            ))}
          </div>
        </div>
        {uploadError && (
          <div className="lg:col-span-4">
            <InlineError message={uploadError} />
          </div>
        )}
        {entry.photos.length > 0 && (
          <div className="flex flex-wrap gap-2 lg:col-span-4">
            {entry.photos.map((photo, index) => (
              <PhotoChip
                key={photo}
                label={`Photo ${index + 1}`}
                href={photo}
                compact
              />
            ))}
          </div>
        )}
        <div className="flex gap-2 lg:col-span-4 lg:justify-end">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={disabled || busy}>
            {uploading ? "Uploading..." : saving ? "Saving..." : "Save entry"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function ReportsView({
  entities,
  employees,
  properties,
  entries,
  notify,
}: {
  entities: Entity[];
  employees: Employee[];
  properties: PropertySite[];
  entries: WorkEntry[];
  notify: (message: string, kind?: Toast["kind"]) => void;
}) {
  const [startDate, setStartDate] = useState("2026-08-01");
  const [endDate, setEndDate] = useState(today);
  const [period, setPeriod] = useState<"all" | "week" | "month" | "custom">(
    "month",
  );
  const [entityFilter, setEntityFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const scopedEntries = entries.filter((entry) => {
    const matchesEmployee =
      employeeFilter === "all" || entry.employeeId === employeeFilter;
    const matchesEntity =
      entityFilter === "all" || getEntryEntityId(entry, properties) === entityFilter;
    const matchesProperty =
      propertyFilter === "all" || entry.propertyId === propertyFilter;
    const matchesPeriod =
      period === "all" ||
      (period === "week" && withinDays(entry.date, 6)) ||
      (period === "month" && monthKey(entry.date) === monthKey(today)) ||
      (period === "custom" && entry.date >= startDate && entry.date <= endDate);

    return matchesEmployee && matchesEntity && matchesProperty && matchesPeriod;
  });
  const entityRows = entityLaborRows(entities, properties, scopedEntries, employees);
  const employeeRows = employees.map((employee) => {
    const employeeEntries = scopedEntries.filter(
      (entry) => entry.employeeId === employee.id,
    );
    const hours = employeeEntries.reduce((sum, entry) => sum + entry.hours, 0);
    const cost = employeeEntries.reduce(
      (sum, entry) => sum + entryCost(entry, employees),
      0,
    );
    return {
      label: employee.name,
      value: hours,
      cost,
    };
  });
  const propertyRows = properties.map((property) => {
    const propertyEntries = scopedEntries.filter(
      (entry) => entry.propertyId === property.id,
    );
    const hours = propertyEntries.reduce((sum, entry) => sum + entry.hours, 0);
    const cost = propertyEntries.reduce(
      (sum, entry) => sum + entryCost(entry, employees),
      0,
    );
    return { label: property.name, value: hours, cost };
  });
  const weeklyTotal = scopedEntries
    .filter((entry) => withinDays(entry.date, 6))
    .reduce((sum, entry) => sum + entry.hours, 0);
  const monthlyTotal = scopedEntries
    .filter((entry) => monthKey(entry.date) === monthKey(today))
    .reduce((sum, entry) => sum + entry.hours, 0);

  function exportCsv() {
    const rows = scopedEntries.map((entry) => ({
      date: entry.date,
      employee:
        getEmployee(employees, entry.employeeId)?.name ??
        entry.employeeName ??
        entry.employeeId,
      entity: getEntryEntityName(entry, properties, entities),
      property:
        getProperty(properties, entry.propertyId)?.name ??
        entry.propertyName ??
        entry.propertyId,
      hours: entry.hours,
      description: entry.description,
      notes: entry.notes ?? "",
      laborCost: entryCost(entry, employees),
      photos: entry.photos.join(" "),
    }));
    const header = [
      "Date",
      "Employee",
      "Entity",
      "Property",
      "Hours",
      "Description",
      "Notes",
      "Labor Cost",
      "Photos",
    ];
    const csv = [
      header.join(","),
      ...rows.map((row) =>
        [
          row.date,
          row.employee,
          row.entity,
          row.property,
          row.hours,
          row.description,
          row.notes,
          row.laborCost,
          row.photos,
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "tr-properties-labor-report.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify("CSV export generated.", "info");
  }

  function placeholderExport(type: "PDF") {
    notify(`${type} export placeholder ready for Google Apps Script wiring.`, "info");
  }

  return (
    <div className="space-y-6">
      <Panel title="Report Controls">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_auto_auto]">
          <FormField label="Period">
            <select
              value={period}
              onChange={(event) =>
                setPeriod(event.target.value as "all" | "week" | "month" | "custom")
              }
              className="input"
            >
              <option value="month">This month</option>
              <option value="week">This week</option>
              <option value="custom">Custom range</option>
              <option value="all">All dates</option>
            </select>
          </FormField>
          <FormField label="Employee">
            <select
              value={employeeFilter}
              onChange={(event) => setEmployeeFilter(event.target.value)}
              className="input"
            >
              <option value="all">All employees</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Entity">
            <select
              value={entityFilter}
              onChange={(event) => setEntityFilter(event.target.value)}
              className="input"
            >
              <option value="all">All entities</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
              <option value="unassigned">Unassigned</option>
            </select>
          </FormField>
          <FormField label="Property">
            <select
              value={propertyFilter}
              onChange={(event) => setPropertyFilter(event.target.value)}
              className="input"
            >
              <option value="all">All properties</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Start date">
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="input"
              disabled={period !== "custom"}
            />
          </FormField>
          <FormField label="End date">
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="input"
              disabled={period !== "custom"}
            />
          </FormField>
          <button
            type="button"
            className="btn-secondary self-end"
            onClick={exportCsv}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="btn-secondary self-end"
            onClick={() => placeholderExport("PDF")}
          >
            Export PDF
          </button>
        </div>
      </Panel>

      <section className="grid gap-4 md:grid-cols-2">
        <MetricCard label="Weekly total hours" value={weeklyTotal} accent="blue" />
        <MetricCard label="Monthly total hours" value={monthlyTotal} accent="green" />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Panel title="Hours by Entity">
          {scopedEntries.length === 0 ? (
            <EmptyState
              title="No report data"
              message="Adjust the filters or add backend work entries to populate this report."
            />
          ) : (
            <BarList
              rows={entityRows.map((row) => ({
                label: row.label,
                value: row.value,
                sublabel: currency(row.cost),
              }))}
            />
          )}
        </Panel>
        <Panel title="Labor Cost by Entity">
          {scopedEntries.length === 0 ? (
            <EmptyState
              title="No entity cost data"
              message="Entity labor cost totals will appear once matching entries are available."
            />
          ) : (
            <BarList
              rows={entityRows.map((row) => ({
                label: row.label,
                value: row.cost,
                valueLabel: currency(row.cost),
                sublabel: `${row.value} hours`,
              }))}
            />
          )}
        </Panel>
        <Panel title="Hours by Employee">
          {scopedEntries.length === 0 ? (
            <EmptyState
              title="No report data"
              message="Adjust the filters or add backend work entries to populate this report."
            />
          ) : (
            <BarList
              rows={employeeRows.map((row) => ({
                label: row.label,
                value: row.value,
                sublabel: currency(row.cost),
              }))}
            />
          )}
        </Panel>
        <Panel title="Hours by Property">
          <BarList
            rows={propertyRows.map((row) => ({
              label: row.label,
              value: row.value,
              sublabel: currency(row.cost),
            }))}
          />
        </Panel>
        <Panel title="Labor Cost by Employee">
          <BarList
            rows={employeeRows.map((row) => ({
              label: row.label,
              value: row.cost,
              valueLabel: currency(row.cost),
              sublabel: `${row.value} hours`,
            }))}
          />
        </Panel>
        <Panel title="Labor Cost by Property">
          <BarList
            rows={propertyRows.map((row) => ({
              label: row.label,
              value: row.cost,
              valueLabel: currency(row.cost),
              sublabel: `${row.value} hours`,
            }))}
          />
        </Panel>
        <Panel title="Properties within Entity">
          {entityRows.length === 0 ? (
            <EmptyState
              title="No entities returned"
              message="Entity property groupings will appear after entities are loaded."
            />
          ) : (
            <div className="space-y-3">
              {entityRows.map((row) => (
                <div
                  key={row.label}
                  className="rounded-lg border border-[#dfe7dc] bg-[#fbfcfa] p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-[#17201a]">{row.label}</p>
                      <p className="mt-1 text-sm text-[#677568]">
                        {row.properties.length > 0
                          ? row.properties
                              .map((property) => property.name)
                              .join(", ")
                          : "No assigned properties"}
                      </p>
                    </div>
                    <span className="rounded-md bg-[#e9f1e8] px-2 py-1 text-xs font-semibold text-[#184b32]">
                      {row.value}h
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}

function LoginView({
  notify,
  toasts,
}: {
  notify: (message: string, kind?: Toast["kind"]) => void;
  toasts: Toast[];
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: code }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || body?.ok === false) {
        throw new Error(body?.error ?? "Could not sign in.");
      }

      notify("Access granted.");
      const params = new URLSearchParams(window.location.search);
      const returnTo = params.get("returnTo") ?? "/";
      window.location.href =
        returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#102217] px-4 py-10 text-white">
      <section className="w-full max-w-md rounded-lg border border-white/10 bg-white p-6 text-[#17201a] shadow-2xl">
        <div className="mb-8">
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-[#c7a75d] text-lg font-black text-[#102217]">
            TR
          </div>
          <h1 className="mt-5 text-2xl font-semibold">
            TR Properties Labor Tracker
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#647067]">
            Shared management login for internal labor tracking. Field workers do
            not have accounts.
          </p>
        </div>
        {error && <InlineError message={error} />}
        <form className="grid gap-4" onSubmit={submit}>
          <FormField label="Internal access code">
            <input
              type="password"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="input"
              placeholder="Enter shared team password"
              disabled={saving}
              required
            />
          </FormField>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Checking..." : "Enter dashboard"}
          </button>
        </form>
      </section>
      <ToastStack toasts={toasts} />
    </main>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {["Employees", "Properties", "Work entries", "Dashboard"].map((label) => (
        <div
          key={label}
          className="min-h-36 animate-pulse rounded-lg border border-[#dfe7dc] bg-white p-5 shadow-sm"
        >
          <div className="h-4 w-32 rounded bg-[#e3eadf]" />
          <div className="mt-5 h-8 w-44 rounded bg-[#edf2ea]" />
          <div className="mt-4 h-3 w-full rounded bg-[#edf2ea]" />
        </div>
      ))}
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mb-5 rounded-lg border border-[#eed3d1] bg-[#fff7f6] p-4 text-[#7e241d]">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="font-semibold">Backend connection issue</p>
          <p className="mt-1 text-sm leading-6">{message}</p>
        </div>
        <button type="button" className="btn-danger" onClick={onRetry}>
          Retry
        </button>
      </div>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-lg border border-[#eed3d1] bg-[#fff7f6] px-4 py-3 text-sm font-semibold text-[#8f2b23]">
      {message}
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[#cbd9c8] bg-[#fbfcfa] p-5 text-sm">
      <p className="font-semibold text-[#17201a]">{title}</p>
      <p className="mt-1 leading-6 text-[#677568]">{message}</p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent = "green",
}: {
  label: string;
  value: string | number;
  accent?: "green" | "gold" | "blue";
}) {
  const accentClass =
    accent === "gold"
      ? "bg-[#f6efd9] text-[#7a5a19]"
      : accent === "blue"
        ? "bg-[#e6eef5] text-[#31506b]"
        : "bg-[#e9f1e8] text-[#184b32]";

  return (
    <article className="rounded-lg border border-[#dfe7dc] bg-white p-5 shadow-sm">
      <div
        className={classNames(
          "mb-5 inline-flex h-10 w-10 items-center justify-center rounded-md text-sm font-black",
          accentClass,
        )}
      >
        {label.slice(0, 1)}
      </div>
      <p className="text-sm font-semibold text-[#677568]">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-[#17201a]">{value}</p>
    </article>
  );
}

function MiniMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg bg-[#f5f8f3] p-4">
      <p className="text-xs font-semibold uppercase text-[#677568]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[#17201a]">{value}</p>
    </div>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[#dfe7dc] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[#17201a]">{title}</h2>
        {action && (
          <div className="text-sm font-semibold text-[#184b32] transition hover:text-[#0f3825]">
            {action}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

function EntryList({
  entries,
  employees,
  properties,
}: {
  entries: WorkEntry[];
  employees: Employee[];
  properties: PropertySite[];
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-[#677568]">No work entries yet.</p>;
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <article
          key={entry.id}
          className="rounded-lg border border-[#dfe7dc] bg-[#fbfcfa] p-4"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="font-semibold text-[#17201a]">
                {getEmployee(employees, entry.employeeId)?.name ??
                  entry.employeeName ??
                  "Unknown"}{" "}
                at{" "}
                {getProperty(properties, entry.propertyId)?.name ??
                  entry.propertyName ??
                  "Unknown"}
              </p>
              <p className="mt-1 text-sm text-[#677568]">
                {shortDate(entry.date)} · {entry.hours} hours ·{" "}
                {currency(entryCost(entry, employees))}
              </p>
              <p className="mt-2 text-sm leading-6 text-[#303b33]">
                {entry.description}
              </p>
            </div>
            <div className="flex min-w-28 flex-wrap gap-1.5 md:justify-end">
              {entry.photos.slice(0, 2).map((photo, index) => (
                <PhotoChip
                  key={photo}
                  label={`Photo ${index + 1}`}
                  compact
                  href={photo}
                />
              ))}
              {entry.photos.length > 2 && (
                <span className="rounded-md bg-[#f2f4f1] px-2 py-1 text-xs font-semibold text-[#677568]">
                  +{entry.photos.length - 2}
                </span>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function BarList({
  rows,
}: {
  rows: {
    label: string;
    value: number;
    valueLabel?: string;
    sublabel?: string;
  }[];
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <div>
              <span className="font-semibold text-[#17201a]">{row.label}</span>
              {row.sublabel && (
                <span className="ml-2 text-[#677568]">{row.sublabel}</span>
              )}
            </div>
            <span className="font-semibold text-[#184b32]">
              {row.valueLabel ?? row.value}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-[#e8eee5]">
            <div
              className="h-full rounded-full bg-[#184b32] transition-all"
              style={{ width: `${Math.max((row.value / max) * 100, 4)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ResponsiveTable({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                className="border-b border-[#dfe7dc] bg-[#f7faf6] px-3 py-3 font-semibold text-[#516053] first:rounded-tl-lg last:rounded-tr-lg"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-[#e6ece3] [&_td]:px-3 [&_td]:py-3 [&_td]:align-top">
          {children}
        </tbody>
      </table>
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-[#3b473e]">
      {label}
      {children}
    </label>
  );
}

function StatusPill({
  label,
  tone = "green",
}: {
  label: string;
  tone?: "green" | "amber" | "blue" | "gray";
}) {
  const tones = {
    green: "bg-[#e9f1e8] text-[#184b32]",
    amber: "bg-[#f8efd8] text-[#76551c]",
    blue: "bg-[#e6eef5] text-[#31506b]",
    gray: "bg-[#eef0ed] text-[#637067]",
  };

  return (
    <span
      className={classNames(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        tones[tone],
      )}
    >
      {label}
    </span>
  );
}

function PhotoChip({
  label,
  compact = false,
  href,
}: {
  label: string;
  compact?: boolean;
  href?: string;
}) {
  const content = (
    <>
      <span className="h-2 w-2 shrink-0 rounded-sm bg-[#c7a75d]" />
      <span className="truncate">{label}</span>
    </>
  );
  const classes = classNames(
    "inline-flex max-w-48 items-center gap-1 rounded-md bg-[#eff4f1] font-semibold text-[#47604e]",
    compact ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-sm",
  );

  if (href && /^https?:\/\//.test(href)) {
    return (
      <a
        href={href}
        className={classes}
        title={label}
        target="_blank"
        rel="noreferrer"
      >
        {content}
      </a>
    );
  }

  return (
    <span
      className={classNames(
        "inline-flex max-w-48 items-center gap-1 rounded-md bg-[#eff4f1] font-semibold text-[#47604e]",
        compact ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-sm",
      )}
      title={label}
    >
      {content}
    </span>
  );
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 grid gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={classNames(
            "rounded-lg px-4 py-3 text-sm font-semibold shadow-lg ring-1",
            toast.kind === "error"
              ? "bg-[#9f2d24] text-white ring-[#9f2d24]"
              : toast.kind === "success"
              ? "bg-[#184b32] text-white ring-[#184b32]"
              : "bg-white text-[#17201a] ring-[#dfe7dc]",
          )}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
