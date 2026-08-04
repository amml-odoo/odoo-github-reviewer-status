# GitHub Reviewer Leave Status

Chrome extension that shows a 🌴 On Leave / ✅ Available / ❓ Unknown badge
next to each reviewer's name on a GitHub pull request page, using live leave
data from Odoo — no separate backend server required.

```
Github Extension/
└── extension/       # the Chrome extension (load this in chrome://extensions)
```

Extension icon is the 🌴 emoji from [Twemoji](https://github.com/twitter/twemoji) (CC-BY 4.0, graphics by Twitter).

## How it works

- The content script (`extension/src/content.js`) scrapes reviewer GitHub
  usernames from the PR sidebar.
- GitHub usernames at Odoo follow the pattern `<gram>-odoo`, where `gram` is
  the person's internal Odoo username (the local part of their `email`, e.g.
  `jsm@odoo.com` → `jsm`). The extension strips the `-odoo` suffix to get
  `gram`.
- The background service worker (`extension/src/api.js`) calls Odoo's
  JSON-RPC endpoint directly:
  `POST https://www.odoo.com/web/dataset/call_kw`, `credentials: "include"`.
  Because the request is made from the browser, it automatically reuses
  whatever Odoo session cookie is already set — **you must be logged into
  Odoo in this browser** for lookups to work. No API keys, no separate
  server.
- One call per lookup: `hr.employee.search_read` on `email`, reading
  `is_absent` and `leave_date_to`. Both fields are added by Odoo's
  `hr_holidays` module, computed via `sudo()` (so they bypass `hr.leave`
  record-rule restrictions) and have no `groups` restriction — any logged-in
  user can read them for any employee, which is what makes a single-call,
  no-extra-permissions lookup possible. (Confirmed by reading
  `hr_holidays/models/hr_employee.py` in the Odoo source: `is_absent` is
  `True` only when a `state = "validate"` leave of `time_type = "leave"`
  covers today; `leave_date_to` is the actual next working day back, already
  accounting for weekends/holidays.)
- If the background lookup fails because you're not logged into Odoo (a
  redirect to `/web/login`, a non-JSON response, or a `SessionExpiredException`
  from the RPC layer), the extension shows one banner at the top of the PR
  page with a link to log in, instead of a warning icon on every reviewer.
  Any other failure (wrong field/model, network error) still shows a ⚠️ badge
  per reviewer, with the error in its tooltip.

## ⚠️ Before relying on this, verify the domain/fields against your instance

Confirm it works for your login before trusting the badges: open your Odoo
backend in a tab (logged in), open DevTools console, and run (swap in your
own gram):

```js
fetch("https://www.odoo.com/web/dataset/call_kw", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    method: "call",
    params: {
      model: "hr.employee",
      method: "search_read",
      args: [[["email", "=ilike", "YOUR_GRAM@%"]], ["email", "is_absent", "leave_date_to"]],
      kwargs: {}
    }
  })
}).then(r => r.json()).then(console.log);
```

- Should return a record with your `email`, `is_absent` (boolean), and
  `leave_date_to` (a date, only set while `is_absent` is true). If `result`
  is empty for a gram you know exists, the email pattern doesn't match your
  instance's convention — adjust the domain in `extension/src/api.js`.
- Any RPC error mentioning an unknown field or model means something needs
  adjusting in `extension/src/api.js` (`fetchLeaveStatus`) to match your
  instance/version.
- If you see the "Log into Odoo" banner on GitHub PR pages, you're not
  logged into `https://www.odoo.com` in this browser.

## 1. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `Github Extension/extension` folder

The extension icon should appear in your toolbar.

## 2. Test it

1. Make sure you're logged into Odoo (`https://www.odoo.com`) in this
   browser.
2. Open any GitHub pull request that has reviewers assigned, e.g.
   `https://github.com/<owner>/<repo>/pull/<number>`.
3. In the right-hand sidebar, under **Reviewers**, each reviewer whose
   GitHub username matches the `<gram>-odoo` pattern should show a badge:
   🌴 on leave today, ✅ available, ❓ no employee match found in Odoo.
4. Click the extension icon in the toolbar — the popup lists the same
   reviewers and statuses for the active tab, with a **Refresh** button to
   re-check without reloading the page (useful right after someone's leave
   status changes in Odoo).
5. Right-click the extension icon → **Options** (or the popup's "Open
   settings" link) to change the Odoo base URL or disable the feature — e.g.
   if your actual database lives at a different subdomain than
   `www.odoo.com`, update it here **and** in `extension/manifest.json`'s
   `host_permissions` (that entry can't be changed at runtime).
6. Navigate between PRs without a full page reload to confirm badges still
   appear — the content script watches the page for changes since GitHub PRs
   are a single-page app.
7. Log out of Odoo in this browser and reload a PR page — instead of ⚠️ on
   every reviewer, you should see one banner at the top of the page prompting
   you to log in. Logging back in and hitting Refresh in the popup should
   clear it.
8. If badges don't appear, check the background service worker's console:
   `chrome://extensions` → the extension → "service worker" link. RPC/auth
   errors are logged there.

## Deployment

This is currently a local/unpacked extension, not published to the Chrome
Web Store:

- **For team use as-is**: everyone who wants it runs "Load unpacked"
  pointing at the `extension/` folder (steps above). Since it talks directly
  to Odoo using each person's own browser session, there's nothing to host.
- **To publish to the Chrome Web Store** (optional, future step): zip the
  `extension/` folder, create a Google Developer account (one-time $5 fee),
  and submit it via the Chrome Web Store Developer Dashboard along with
  icons/screenshots and a store listing description.
