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

function dayValue(value) {
  if (!validDate(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function addMonths(value, months) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, day));
  return date.toISOString().slice(0, 10);
}

function inDateRange(date, startDate, endDate) {
  const target = dayValue(date);
  const start = dayValue(startDate);
  const end = dayValue(endDate || startDate);
  return target !== null && start !== null && end !== null && target >= start && target <= end;
}

function repeatedTimeoffMatchesDate(timeoff, date) {
  const repeatState = Number(timeoff?.repeat_state || 0);
  const startDate = timeoff?.start_date;
  const endDate = timeoff?.end_date || startDate;
  if (!repeatState) return inDateRange(date, startDate, endDate);
  if (!validDate(startDate) || !validDate(date)) return false;
  if (validDate(timeoff?.repeat_end) && dayValue(date) > dayValue(timeoff.repeat_end)) return false;

  const startDay = dayValue(startDate);
  const targetDay = dayValue(date);
  const durationDays = Math.max(dayValue(endDate) - startDay, 0);
  if (targetDay < startDay) return false;

  const dayPeriods = { 1: 7, 3: 14, 4: 21, 5: 42 };
  if (dayPeriods[repeatState]) {
    return (targetDay - startDay) % dayPeriods[repeatState] <= durationDays;
  }

  const monthPeriods = { 2: 1, 6: 2, 7: 3, 8: 6, 9: 12 };
  const monthPeriod = monthPeriods[repeatState];
  if (!monthPeriod) return false;
  const [startYear, startMonth] = startDate.split("-").map(Number);
  const [targetYear, targetMonth] = date.split("-").map(Number);
  const monthsSinceStart = (targetYear - startYear) * 12 + (targetMonth - startMonth);
  const baseMonths = Math.floor(monthsSinceStart / monthPeriod) * monthPeriod;
  return [baseMonths, baseMonths - monthPeriod].some((months) => {
    if (months < 0) return false;
    const occurrenceStart = addMonths(startDate, months);
    const occurrenceEnd = addMonths(endDate, months);
    return inDateRange(date, occurrenceStart, occurrenceEnd);
  });
}

function timeoffMatchesDate(timeoff, date) {
  return repeatedTimeoffMatchesDate(timeoff, date);
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

function isArchivedPerson(person) {
  return person?.archived === 1 || person?.archived === true || person?.active === 0;
}

function avatarUrl(person) {
  if (!person) return null;
  const avatarFile = person.avatar_file;
  return (
    (typeof avatarFile === "string" ? avatarFile : avatarFile?.url || avatarFile?.src || avatarFile?.path) ||
    person.avatar_url ||
    person.profile_image_url ||
    person.profile_photo_url ||
    person.photo_url ||
    person.image_url ||
    person.avatar ||
    null
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

function timeoffTypeName(type) {
  if (!type) return "";
  return type.name || type.timeoff_type_name || type.type || "";
}

function timeoffLabel(timeoff, type) {
  const candidates = [
    timeoff?.timeoff_type_name,
    timeoff?.timeoff_name,
    timeoff?.type_name,
    timeoff?.category_name,
    timeoff?.name,
    timeoff?.type,
    timeoff?.category,
    timeoff?.notes,
    timeoffTypeName(type),
  ];
  return candidates.map((value) => String(value || "").trim()).find(Boolean) || "Time off";
}

function timeoffTypeId(timeoff) {
  return (
    timeoff?.timeoff_type_id ||
    timeoff?.type_id ||
    timeoff?.timeoffTypeId ||
    timeoff?.timeoff_type?.id ||
    timeoff?.type?.id ||
    null
  );
}

function timeoffPeopleIds(timeoff) {
  const ids = Array.isArray(timeoff?.people_ids) ? timeoff.people_ids : [timeoff?.people_id];
  return ids.filter((id) => id !== undefined && id !== null).map(String);
}

function isSickLeave(timeoff, type) {
  return /\bsick\b/i.test(timeoffLabel(timeoff, type));
}

function taskIsTimeOff(task, project) {
  return /\btime\s*off\b|\bleave\b|\bpto\b|\bsick\b/i.test(
    [
      task?.name,
      task?.task_name,
      task?.phase_name,
      task?.notes,
      task?.type,
      task?.status,
      project?.name,
      project?.project_name,
    ].join(" ")
  );
}

function taskIsSickLeave(task, project) {
  return /\bsick\b/i.test(
    [
      task?.name,
      task?.task_name,
      task?.phase_name,
      task?.notes,
      task?.type,
      task?.status,
      project?.name,
      project?.project_name,
    ].join(" ")
  );
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

async function optionalFetchAll(path, token, params = {}) {
  try {
    return await floatFetchAll(path, token, params);
  } catch {
    return [];
  }
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
      const timeoffs = await optionalFetchAll("/timeoffs", token, {
        start_date: date,
        end_date: date,
      });
      const matchingTimeoffs = timeoffs.filter((timeoff) => timeoffMatchesDate(timeoff, date));
      const timeoffTypes = await optionalFetchAll("/timeoff-types", token);
      const timeoffTypesById = mapById(timeoffTypes, ["timeoff_type_id", "type_id", "id"]);
      const timeoffPersonIds = matchingTimeoffs.flatMap(timeoffPeopleIds);
      const absentPeopleIds = new Set();

      const projectsById = await lookupById("/projects", token, tasks.map((task) => task.project_id));
      const accounts = await floatFetchAll("/accounts", token);
      const accountsById = mapById(accounts, ["account_id", "id"]);
      const peopleById = await lookupById("/people", token, [
        ...tasks.map((task) => task.people_id),
        ...timeoffPersonIds,
        ...Object.values(projectsById).map(ownerId),
      ]);
      const absencesByResource = new Map();
      const sickLeavesByResource = new Map();
      matchingTimeoffs
        .flatMap((timeoff) => {
          const typeId = timeoffTypeId(timeoff);
          const type = timeoffTypesById[String(typeId)];
          return timeoffPeopleIds(timeoff).map((peopleId) => {
            const person = peopleById[String(peopleId)];
            return {
              resource: displayName(person),
              people_id: Number(peopleId),
              archived: isArchivedPerson(person),
              reason: timeoffLabel(timeoff, type),
              timeoff_type_id: typeId,
              timeoff,
              hours: timeoff.full_day ? null : Number(timeoff.hours) || null,
              fullDay: timeoff.full_day === 1 || timeoff.full_day === true,
              status: timeoff.status || null,
              sick: isSickLeave(timeoff, type),
            };
          });
        })
        .filter((absence) => !absence.archived && absence.resource && absence.resource !== "Unknown resource" && !/^Person \d+$/i.test(absence.resource))
        .forEach((absence) => {
          absentPeopleIds.add(String(absence.people_id));
          const target = absence.sick ? sickLeavesByResource : absencesByResource;
          const existing = target.get(absence.resource);
          if (!existing) {
            target.set(absence.resource, absence);
          } else if (absence.hours) {
            existing.hours = Number(existing.hours || 0) + Number(absence.hours || 0);
          }
        });
      const rows = tasks
        .map((task, index) => {
          const project = projectsById[String(task.project_id)];
          const person = peopleById[String(task.people_id)];
          const resource = displayName(person);
          const timeOff = taskIsTimeOff(task, project);
          const sickLeave = taskIsSickLeave(task, project);
          if (timeOff && resource && resource !== "Unknown resource" && !/^Person \d+$/i.test(resource)) {
            absentPeopleIds.add(String(task.people_id));
            const target = sickLeave ? sickLeavesByResource : absencesByResource;
            if (!target.has(resource)) {
              target.set(resource, {
                resource,
                reason: sickLeave ? "Sick leave" : "Time off",
                hours: Number(task.hours) || null,
                fullDay: !pickTime(task, "startTime"),
              });
            }
          }
          return {
            resource,
            avatarUrl: avatarUrl(person),
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
            timeOff,
          };
        })
        .filter((row) => row.resource && row.resource !== "Unknown resource" && !/^Person \d+$/i.test(row.resource))
        .filter((row) => !row.timeOff)
        .filter((row) => !absentPeopleIds.has(String(tasks[row.order]?.people_id)));

      return json({
        date,
        rows,
        absences: [...absencesByResource.values()].sort((a, b) => a.resource.localeCompare(b.resource)),
        sickLeaves: [...sickLeavesByResource.values()].sort((a, b) => a.resource.localeCompare(b.resource)),
        debug: url.searchParams.get("debug") === "1" ? {
          timeoffCount: matchingTimeoffs.length,
          rawTimeoffCount: timeoffs.length,
          timeoffKeys: [...new Set(timeoffs.flatMap((timeoff) => Object.keys(timeoff || {})))],
          timeoffSamples: matchingTimeoffs.slice(0, 3).map((timeoff) => ({
            people_ids: timeoffPeopleIds(timeoff),
            timeoff_type_id: timeoffTypeId(timeoff),
            start_date: timeoff.start_date,
            end_date: timeoff.end_date,
            repeat_state: timeoff.repeat_state,
            repeat_end: timeoff.repeat_end,
            label: timeoffLabel(timeoff, timeoffTypesById[String(timeoffTypeId(timeoff))]),
            sick: isSickLeave(timeoff, timeoffTypesById[String(timeoffTypeId(timeoff))]),
            keys: Object.keys(timeoff || {}),
          })),
        } : undefined,
      }, 200, cacheControl);
    } catch (error) {
      return json({ error: error.message || "Failed to load Float data." }, 502);
    }
  },
};
