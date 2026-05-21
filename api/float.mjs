const FLOAT_API_BASE = "https://api.float.com/v3";

function json(data, status = 200, cacheControl = "s-maxage=60, stale-while-revalidate=300") {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": cacheControl,
    },
  });
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

function displayName(person) {
  if (!person) return "Unknown resource";
  return (
    person.name ||
    person.full_name ||
    [person.first_name, person.last_name].filter(Boolean).join(" ") ||
    person.email ||
    `Person ${person.people_id || person.id}`
  );
}

function accountName(account) {
  if (!account) return null;
  return (
    account.name ||
    account.full_name ||
    [account.first_name, account.last_name].filter(Boolean).join(" ") ||
    account.email ||
    null
  );
}

function mapById(rows, keys) {
  const map = {};
  rows.forEach((row) => {
    keys.forEach((key) => {
      if (row?.[key]) map[String(row[key])] = row;
    });
  });
  return map;
}

function projectName(project) {
  if (!project) return "Unknown project";
  return project.name || project.project_name || `Project ${project.project_id || project.id}`;
}

function projectColor(project) {
  const raw = String(project?.color || "").replace("#", "").trim();
  return /^[0-9a-f]{6}$/i.test(raw) ? raw : null;
}

function taskName(task) {
  return task.name || task.task_name || task.phase_name || "Allocation";
}

function isTentative(task) {
  const status = String(task.status ?? task.status_id ?? "").toLowerCase();
  return status === "1" || status === "tentative" || task.tentative === 1 || task.tentative === true;
}

function sortOrder(task, fallback) {
  const value = task.sort_order ?? task.order ?? task.task_order ?? task.priority ?? task.position;
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function ownerId(project) {
  const ownerCandidates = [
    project?.owner,
    project?.project_owner,
    project?.project_manager,
    project?.manager,
  ];
  const ownerValue = ownerCandidates.find((value) => {
    if (!value) return false;
    if (typeof value === "number") return true;
    if (typeof value === "string") return /^\d+$/.test(value);
    return value.id || value.people_id || value.person_id;
  });
  if (ownerValue) {
    if (typeof ownerValue === "number" || typeof ownerValue === "string") return String(ownerValue);
    return String(ownerValue.id || ownerValue.people_id || ownerValue.person_id);
  }

  const id =
    project?.owner_id ||
    project?.project_owner_id ||
    project?.project_manager_id ||
    project?.manager_id ||
    project?.created_by;
  return id ? String(id) : null;
}

function ownerName(project, peopleById = {}, accountsById = {}) {
  const owner =
    project?.owner ||
    project?.project_owner ||
    project?.project_manager ||
    project?.manager ||
    project?.owner_name ||
    project?.project_owner_name ||
    project?.project_manager_name ||
    project?.manager_name ||
    project?.created_by_name;

  if (!owner) return "Unassigned owner";
  if (typeof owner === "number") {
    return accountName(accountsById[String(owner)]) || (peopleById[String(owner)] ? displayName(peopleById[String(owner)]) : "Unassigned owner");
  }
  if (typeof owner === "string") {
    return /^\d+$/.test(owner) ? accountName(accountsById[owner]) || (peopleById[owner] ? displayName(peopleById[owner]) : "Unassigned owner") : owner;
  }
  return displayName(owner);
}

function pickTime(task, key) {
  return task[key] || task[key.replace("Time", "_time")] || null;
}

function minutes(time) {
  if (!time) return null;
  const [hours, mins] = String(time).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
  return hours * 60 + mins;
}

function timeFromMinutes(value) {
  const hours = Math.floor(value / 60) % 24;
  const mins = Math.round(value % 60);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function endTime(task) {
  const explicit = pickTime(task, "endTime");
  const start = pickTime(task, "startTime");
  const startMinutes = minutes(start);
  const hours = Number(task.hours) || 0;
  if (explicit || startMinutes === null || !hours) return explicit;
  return timeFromMinutes(startMinutes + hours * 60);
}

async function floatFetch(path, token, params = {}) {
  const url = new URL(`${FLOAT_API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || body?.error || `Float API returned HTTP ${res.status}`;
    throw new Error(message);
  }

  return body;
}

async function floatFetchAll(path, token, params = {}) {
  const rows = [];
  let page = 1;
  let pageCount = 1;

  do {
    const urlParams = { ...params, page, "per-page": 200 };
    const url = new URL(`${FLOAT_API_BASE}${path}`);
    Object.entries(urlParams).forEach(([key, value]) => url.searchParams.set(key, value));

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = body?.message || body?.error || `Float API returned HTTP ${res.status}`;
      throw new Error(message);
    }

    rows.push(...(Array.isArray(body) ? body : body?.data || []));
    pageCount = Number(res.headers.get("X-Pagination-Page-Count") || 1);
    page += 1;
  } while (page <= pageCount);

  return rows;
}

async function lookupById(path, token, ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const entries = await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const value = await floatFetch(`${path}/${id}`, token);
        return [String(id), value];
      } catch {
        return [String(id), null];
      }
    })
  );
  return Object.fromEntries(entries);
}

export default {
  async fetch(request) {
    const token = process.env.FLOAT_API_TOKEN;
    if (!token) {
      return json({ error: "Missing FLOAT_API_TOKEN in Vercel environment variables." }, 500);
    }

    const url = new URL(request.url);
    const date = url.searchParams.get("date");
    const fresh = url.searchParams.get("fresh") === "1";
    const cacheControl = fresh ? "no-store, max-age=0" : "s-maxage=60, stale-while-revalidate=300";
    if (!validDate(date)) {
      return json({ error: "Use a date query like /api/float?date=2026-05-21." }, 400);
    }

    try {
      const tasks = await floatFetchAll("/tasks", token, {
        start_date: date,
        end_date: date,
      });

      const projectsById = await lookupById("/projects", token, tasks.map((task) => task.project_id));
      const accounts = await floatFetchAll("/accounts", token);
      const accountsById = mapById(accounts, ["account_id", "id"]);
      const peopleById = await lookupById("/people", token, [
        ...tasks.map((task) => task.people_id),
        ...Object.values(projectsById).map(ownerId),
      ]);

      const rows = tasks
        .map((task, index) => {
          const project = projectsById[String(task.project_id)];
          const person = peopleById[String(task.people_id)];
          const resource = displayName(person);
          return {
            resource,
            project: projectName(project),
            projectColor: projectColor(project),
            owner: ownerName(project, peopleById, accountsById),
            taskName: taskName(task),
            notes: task.notes || "",
            hours: Number(task.hours) || 0,
            startDate: task.start_date || date,
            endDate: task.end_date || date,
            startTime: pickTime(task, "startTime"),
            endTime: endTime(task),
            tentative: isTentative(task),
            sortOrder: sortOrder(task, index),
            order: index,
          };
        })
        .filter((row) => row.resource && row.resource !== "Unknown resource" && !/^Person \d+$/i.test(row.resource));

      return json({ date, rows }, 200, cacheControl);
    } catch (error) {
      return json({ error: error.message || "Failed to load Float data." }, 502);
    }
  },
};
