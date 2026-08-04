const statusEl = document.getElementById("status");
const listEl = document.getElementById("reviewer-list");
const refreshButton = document.getElementById("refresh");

const STATUS_META = {
  on_leave: { icon: "🌴", className: "on-leave", label: "On Leave" },
  available: { icon: "✅", className: "available", label: "Available" },
  unknown: { icon: "❓", className: "unknown", label: "No leave information" },
  error: { icon: "⚠️", className: "error", label: "Could not check leave status" },
};

function renderResults(results) {
  listEl.innerHTML = "";
  if (results.length === 0) {
    statusEl.textContent = "No reviewers found on this PR.";
    return;
  }

  statusEl.textContent = `${results.length} reviewer(s) found`;
  results.forEach((r) => {
    const meta = STATUS_META[r.status] || STATUS_META.unknown;

    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = r.username;

    const badge = document.createElement("span");
    badge.className = `badge ${meta.className}`;
    badge.textContent = meta.icon;
    if (r.status === "on_leave" && r.returnDate) {
      badge.title = `On leave — back on ${r.returnDate}`;
    } else if (r.status === "error" && r.errorMessage) {
      badge.title = `${meta.label}: ${r.errorMessage}`;
    } else {
      badge.title = meta.label;
    }

    li.appendChild(name);
    li.appendChild(badge);
    listEl.appendChild(li);
  });
}

function getActiveGithubPrTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url || !/^https:\/\/github\.com\/.+\/pull\//.test(tab.url)) {
        resolve(null);
        return;
      }
      resolve(tab);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

async function loadCurrentStatus() {
  const tab = await getActiveGithubPrTab();
  if (!tab) {
    statusEl.textContent = "Open a GitHub PR to see reviewer leave status.";
    refreshButton.disabled = true;
    return;
  }

  const response = await sendTabMessage(tab.id, { type: "GET_REVIEWER_STATUS" });
  if (!response) {
    statusEl.textContent = "Could not read reviewer status from this page. Try reloading it.";
    return;
  }
  renderResults(response.results);
}

refreshButton.addEventListener("click", async () => {
  const tab = await getActiveGithubPrTab();
  if (!tab) return;

  refreshButton.disabled = true;
  refreshButton.textContent = "Refreshing…";
  statusEl.textContent = "Refreshing…";

  const response = await sendTabMessage(tab.id, { type: "REFRESH_LEAVE_STATUS" });

  refreshButton.disabled = false;
  refreshButton.textContent = "Refresh";

  if (!response) {
    statusEl.textContent = "Refresh failed. Try reloading the PR page.";
    return;
  }
  renderResults(response.results);
});

loadCurrentStatus();
