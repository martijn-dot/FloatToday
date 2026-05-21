const FLOAT_API_BASE = "https://api.float.com/v3";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
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

function taskName(task) {
  return task.name || task.task_name || task.phase_name || "Allocation";
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
    if (!validDate(date)) {
      return json({ error: "Use a date query like /api/float?date=2026-05-21." }, 400);
    }

    try {
      const tasks = await floatFetchAll("/tasks", token, {
        start_date: date,
        end_date: date,
        sort: "start_date",
      });

      const projectsById = await lookupById("/projects", token, tasks.map((task) => task.project_id));
      const accounts = await floatFetchAll("/accounts", token);
      const accountsById = mapById(accounts, ["account_id", "id"]);
      const peopleById = await lookupById("/people", token, [
        ...tasks.map((task) => task.people_id),
        ...Object.values(projectsById).map(ownerId),
      ]);

      const rows = tasks
        .map((task) => {
          const project = projectsById[String(task.project_id)];
          const person = peopleById[String(task.people_id)];
          const resource = displayName(person);
          return {
            resource,
            project: projectName(project),
            owner: ownerName(project, peopleById, accountsById),
            taskName: taskName(task),
            notes: task.notes || "",
            hours: Number(task.hours) || 0,
            startDate: task.start_date || date,
            endDate: task.end_date || date,
            startTime: pickTime(task, "startTime"),
            endTime: pickTime(task, "endTime"),
          };
        })
        .filter((row) => row.resource && row.resource !== "Unknown resource" && !/^Person \d+$/i.test(row.resource));

      return json({ date, rows });
    } catch (error) {
      return json({ error: error.message || "Failed to load Float data." }, 502);
    }
  },
};
