(() => {
  const BADGE_CLASS = "leave-status-badge";
  const PROCESSED_ATTR = "data-leave-status-checked";
  const BANNER_CLASS = "leave-status-session-banner";
  const LOG_PREFIX = "[Reviewer Leave Status]";
  let lastKnownStatuses = [];

  const STATUS_META = {
    on_leave: { icon: "🌴", className: "on-leave", label: "On Leave" },
    available: { icon: "✅", className: "available", label: "Available" },
    unknown: { icon: "❓", className: "unknown", label: "No leave information" },
    error: { icon: "⚠️", className: "error", label: "Could not check leave status" },
  };

  function findReviewerLinks() {
    // GitHub's PR sidebar "Reviewers" section: a heading followed by a list of
    // avatar links pointing at /<username>. We locate the section by its
    // heading text (stable across GitHub's markup changes) rather than a
    // specific class name.
    const headings = Array.from(
      document.querySelectorAll("h2, h3, [class*='discussion-sidebar-heading']")
    );
    const reviewersHeading = headings.find((h) =>
      h.textContent.trim().toLowerCase().startsWith("reviewers")
    );
    if (!reviewersHeading) return [];

    const container = reviewersHeading.closest("div")?.parentElement || reviewersHeading.parentElement;
    if (!container) return [];

    const links = Array.from(container.querySelectorAll("a[href^='/']"));
    return links.filter((link) => {
      const href = link.getAttribute("href") || "";
      // Reviewer profile links look like "/username", not "/org/repo/..."
      return /^\/[^/]+\/?$/.test(href) && link.querySelector("img");
    });
  }

  function extractUsername(link) {
    const href = link.getAttribute("href") || "";
    return href.replace(/^\//, "").replace(/\/$/, "");
  }

  function findRowContainer(link) {
    // The avatar link alone only wraps the <img>; the reviewer's visible
    // username lives in a sibling element a level or two up. Climb until we
    // reach an ancestor whose text is longer than the link's own text (i.e.
    // it also contains the name), so the badge can be appended after it.
    const linkTextLength = (link.textContent || "").trim().length;
    let node = link.parentElement;
    for (let i = 0; i < 5 && node && node !== document.body; i++) {
      if (node.textContent.trim().length > linkTextLength) {
        return node;
      }
      node = node.parentElement;
    }
    return link.parentElement;
  }

  function removeBadge(link) {
    const row = findRowContainer(link);
    row.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
    link.removeAttribute(PROCESSED_ATTR);
  }

  function injectBadge(link, status) {
    if (link.hasAttribute(PROCESSED_ATTR)) return;
    link.setAttribute(PROCESSED_ATTR, "true");

    const meta = STATUS_META[status.status] || STATUS_META.unknown;

    const badge = document.createElement("span");
    badge.className = `${BADGE_CLASS} ${meta.className}`;
    badge.textContent = meta.icon;
    if (status.status === "on_leave" && status.returnDate) {
      badge.title = `On leave — back on ${status.returnDate}`;
    } else if (status.status === "error" && status.errorMessage) {
      badge.title = `${meta.label}: ${status.errorMessage}`;
    } else {
      badge.title = meta.label;
    }
    

    const row = findRowContainer(link);
    row.appendChild(badge);
  }

  function showSessionBanner(odooBaseUrl) {
    if (document.querySelector(`.${BANNER_CLASS}`)) return;
    const banner = document.createElement("div");
    banner.className = BANNER_CLASS;
    const link = document.createElement("a");
    link.href = odooBaseUrl || "https://www.odoo.com";
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Log into Odoo";
    banner.append("⚠️ Not logged into Odoo — reviewer leave status is unavailable. ", link);
    document.body.prepend(banner);
  }

  function hideSessionBanner() {
    document.querySelectorAll(`.${BANNER_CLASS}`).forEach((el) => el.remove());
  }

  function sendMessageAsync(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message, code: null });
          return;
        }
        resolve(response || { ok: false, error: "No response from background", code: null });
      });
    });
  }

  async function runCheck(links) {
    const usernames = links.map(extractUsername).filter(Boolean);
    const uniqueUsernames = Array.from(new Set(usernames));
    if (uniqueUsernames.length === 0) return;

    console.debug(`${LOG_PREFIX} checking leave status for`, uniqueUsernames);
    const response = await sendMessageAsync({ type: "CHECK_LEAVE", usernames: uniqueUsernames });

    if (!response.ok) {
      console.error(`${LOG_PREFIX} lookup failed:`, response.error);

      if (response.code === "NOT_LOGGED_IN") {
        // One clear banner beats a warning icon next to every reviewer.
        showSessionBanner(response.odooBaseUrl);
        lastKnownStatuses = uniqueUsernames.map((username) => ({
          username,
          status: "error",
          errorMessage: "Not logged into Odoo",
        }));
        return;
      }

      links.forEach((link) =>
        injectBadge(link, { status: "error", errorMessage: response.error })
      );
      lastKnownStatuses = uniqueUsernames.map((username) => ({
        username,
        status: "error",
        errorMessage: response.error,
      }));
      return;
    }

    hideSessionBanner();
    console.debug(`${LOG_PREFIX} results:`, response.results);
    const byUsername = {};
    response.results.forEach((r) => {
      byUsername[r.username.toLowerCase()] = r;
    });

    links.forEach((link) => {
      const username = extractUsername(link);
      const status = byUsername[username.toLowerCase()];
      if (status) injectBadge(link, status);
    });

    lastKnownStatuses = response.results;
  }

  function checkAndAnnotateReviewers() {
    const links = findReviewerLinks().filter((l) => !l.hasAttribute(PROCESSED_ATTR));
    if (links.length === 0) {
      console.debug(`${LOG_PREFIX} no unprocessed reviewer links found on this pass`);
      return;
    }
    runCheck(links);
  }

  async function refreshAllReviewers() {
    const links = findReviewerLinks();
    links.forEach(removeBadge);
    await runCheck(links);
    return lastKnownStatuses;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_REVIEWER_STATUS") {
      sendResponse({ ok: true, results: lastKnownStatuses });
      return false;
    }
    if (message.type === "REFRESH_LEAVE_STATUS") {
      refreshAllReviewers().then((results) => sendResponse({ ok: true, results }));
      return true; // async response
    }
    return false;
  });

  // Initial pass, and re-run on GitHub's client-side navigation / async
  // sidebar loading (PR pages are a React SPA, no full page reload).
  checkAndAnnotateReviewers();

  const observer = new MutationObserver(() => {
    checkAndAnnotateReviewers();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
