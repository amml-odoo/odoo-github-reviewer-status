const DEFAULT_ODOO_BASE_URL = "https://www.odoo.com";

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { odooBaseUrl: DEFAULT_ODOO_BASE_URL, enabled: true },
      (items) => resolve(items)
    );
  });
}

// GitHub usernames at Odoo follow "<gram>-odoo"; "gram" is the person's
// internal username/email local-part in Odoo (e.g. "jsm-odoo" -> "jsm").
function githubUsernameToGram(username) {
  const match = /^(.+?)-odoo$/i.exec(username);
  return match ? match[1] : null;
}

function buildOrDomain(conditions) {
  if (conditions.length <= 1) return conditions;
  const orOperators = new Array(conditions.length - 1).fill("|");
  return [...orOperators, ...conditions];
}

async function callOdoo(baseUrl, model, method, args, kwargs = {}) {
  const url = `${baseUrl.replace(/\/$/, "")}/web/dataset/call_kw`;
  const response = await fetch(url, {
    method: "POST",
    credentials: "include", // reuse the browser's existing Odoo session cookie
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { model, method, args, kwargs },
    }),
  });

  // A logged-out session gets redirected to /web/login (an HTML page), not a
  // JSON-RPC error — surface that distinctly so the UI can prompt to log in
  // instead of showing a generic per-reviewer warning.
  if (response.url.includes("/web/login")) {
    const err = new Error("Not logged into Odoo in this browser");
    err.code = "NOT_LOGGED_IN";
    throw err;
  }

  if (!response.ok) {
    throw new Error(`Odoo returned HTTP ${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const err = new Error("Unexpected response from Odoo — you may be logged out");
    err.code = "NOT_LOGGED_IN";
    throw err;
  }

  if (payload.error) {
    const errName = payload.error.data?.name || "";
    const message = payload.error.data?.message || payload.error.message;
    const err = new Error(`Odoo RPC error: ${message}`);
    if (errName.includes("SessionExpiredException")) {
      err.code = "NOT_LOGGED_IN";
    }
    throw err;
  }
  return payload.result;
}

async function fetchLeaveStatus(usernames, odooBaseUrl) {
  if (!usernames || usernames.length === 0) return [];
  const base = odooBaseUrl || DEFAULT_ODOO_BASE_URL;

  const gramByUsername = {};
  const grams = [];
  usernames.forEach((username) => {
    const gram = githubUsernameToGram(username);
    gramByUsername[username] = gram;
    if (gram) grams.push(gram);
  });

  if (grams.length === 0) {
    return usernames.map((username) => ({ username, status: "unknown", returnDate: null }));
  }

  const emailConditions = grams.map((gram) => ["email", "=ilike", `${gram}@%`]);
  const employeeDomain = buildOrDomain(emailConditions);

  // hr.employee.is_absent / leave_date_to are computed by hr_holidays via
  // sudo(), so they're readable by any user regardless of hr.leave record
  // rules — no separate hr.leave query needed.
  const employees = await callOdoo(base, "hr.employee", "search_read", [
    employeeDomain,
    ["email", "is_absent", "leave_date_to"],
  ]);

  const employeeByGram = {};
  employees.forEach((emp) => {
    const local = (emp.email || "").split("@")[0].toLowerCase();
    if (local) employeeByGram[local] = emp;
  });

  return usernames.map((username) => {
    const gram = gramByUsername[username];
    const employee = gram ? employeeByGram[gram.toLowerCase()] : null;

    if (!employee) {
      return { username, status: "unknown", returnDate: null };
    }
    return {
      username,
      status: employee.is_absent ? "on_leave" : "available",
      returnDate: employee.is_absent ? employee.leave_date_to || null : null,
    };
  });
}
