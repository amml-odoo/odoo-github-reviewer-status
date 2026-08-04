const DEFAULT_ODOO_BASE_URL = "https://www.odoo.com";

const odooBaseUrlInput = document.getElementById("odooBaseUrl");
const enabledInput = document.getElementById("enabled");
const saveButton = document.getElementById("save");
const savedLabel = document.getElementById("saved");

function loadSettings() {
  chrome.storage.sync.get(
    { odooBaseUrl: DEFAULT_ODOO_BASE_URL, enabled: true },
    (items) => {
      odooBaseUrlInput.value = items.odooBaseUrl;
      enabledInput.checked = items.enabled;
    }
  );
}

saveButton.addEventListener("click", () => {
  const odooBaseUrl = odooBaseUrlInput.value.trim() || DEFAULT_ODOO_BASE_URL;
  const enabled = enabledInput.checked;

  chrome.storage.sync.set({ odooBaseUrl, enabled }, () => {
    savedLabel.style.display = "inline";
    setTimeout(() => (savedLabel.style.display = "none"), 1500);
  });
});

loadSettings();
