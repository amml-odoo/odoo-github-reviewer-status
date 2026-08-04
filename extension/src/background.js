importScripts("api.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ odooBaseUrl: DEFAULT_ODOO_BASE_URL, enabled: true }, (items) => {
    chrome.storage.sync.set(items);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "CHECK_LEAVE") return false;

  (async () => {
    const settings = await getSettings();
    try {
      if (!settings.enabled) {
        sendResponse({ ok: true, results: [] });
        return;
      }
      const results = await fetchLeaveStatus(message.usernames, settings.odooBaseUrl);
      sendResponse({ ok: true, results });
    } catch (err) {
      console.error("[Reviewer Leave Status] Odoo lookup failed:", err);
      sendResponse({
        ok: false,
        error: err.message,
        code: err.code || null,
        odooBaseUrl: settings.odooBaseUrl,
      });
    }
  })();

  return true; // keep the message channel open for the async response
});
