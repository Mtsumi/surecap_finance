# Surecap Finance — Credit Risk & Loan Application Form

A mobile-first, multi-step loan application web form for **Surecap Finance**. Submissions are sent to a Google Sheet via a Google Apps Script Web App.

---

## What’s in This Project

| File | Purpose |
|------|--------|
| **`index.html`** | Single-page form (HTML + CSS + JS). Users fill it in the browser; no build step. |
| **`appscript.js`** | Backend that runs **on Google’s servers**. Receives form data via HTTP POST and appends a row to a Google Sheet. |
| **`README.md`** | This documentation. |

### Where does `appscript.js` live?

- **In this repo:** It’s in the same folder for version control and reference. You don’t “run” it locally.
- **In production:** You copy its contents into **Google Sheets → Extensions → Apps Script**, then deploy it as a **Web App**. The form in `index.html` calls that Web App URL.

So: keep `appscript.js` in this folder for code history; the *running* backend is the deployed Apps Script in your Google account.

---

## How the Pieces Work Together

```
┌─────────────────────────────────────────────────────────────────┐
│  User's browser                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  index.html  (open in browser or served by any web host) │   │
│  │  - 9-step form, progress bar, validation, calculations  │   │
│  │  - On "Submit": POST JSON payload to APPS_SCRIPT_URL       │   │
│  └───────────────────────────┬───────────────────────────────┘   │
└──────────────────────────────│───────────────────────────────────┘
                               │ HTTPS POST (JSON)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Google's servers (Apps Script Web App)                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  appscript.js  (doPost)                                  │   │
│  │  - Parse JSON from request body                         │   │
│  │  - Append one row to the active Google Sheet            │   │
│  │  - Return { result: "success" } or { result: "error" } │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Google Sheet (same spreadsheet where you added the script)     │
│  - One new row per submission                                   │
│  - Columns match the order in appscript.js                      │
└─────────────────────────────────────────────────────────────────┘
```

1. **User** opens `index.html` (locally or from a server), fills the 9 steps, and clicks **Submit Application**.
2. **index.html** builds a JSON object with all fields (including signature as base64 PNG), then `fetch()` POSTs it to `APPS_SCRIPT_URL`.
3. **Google Apps Script** receives the request in `doPost(e)`, parses `e.postData.contents`, and appends a row to the active sheet.
4. **Script** responds with `{ result: "success" }` or `{ result: "error", message: "..." }`.
5. **index.html** shows the confirmation screen on success, or an error message + **Retry** without clearing the form.

---

## How to Run the Whole Thing

### 1. Backend (Google Sheets + Apps Script)

1. Create a **new Google Sheet** (or use an existing one).
2. In the sheet: **Extensions → Apps Script**.
3. Delete any default code in the editor, then **paste the entire contents of `appscript.js`** from this folder.
4. Save the project (e.g. name it “Surecap Form Backend”).
5. **Deploy:** Click **Deploy → New deployment**:
   - Type: **Web app**
   - Description: e.g. “Surecap form”
   - **Execute as:** Me (your Google account)
   - **Who has access:** “Anyone” (so the form can POST from any origin; the script only writes to your sheet)
6. Click **Deploy**, authorize if asked, then **copy the Web App URL** (looks like `https://script.google.com/macros/s/.../exec`).

### 2. Frontend (the form)

1. Open **`index.html`** in this folder.
2. Find the line:
   ```javascript
   const APPS_SCRIPT_URL = "PASTE_YOUR_DEPLOYED_APPS_SCRIPT_URL_HERE";
   ```
3. Replace `"PASTE_YOUR_DEPLOYED_APPS_SCRIPT_URL_HERE"` with the Web App URL you copied (keep the quotes).
4. Save the file.

### 3. Open the form

- **Local:** Double-click `index.html` or open it from your file manager. Or run a simple local server, e.g.:
  ```bash
  # From this project folder (Python 3)
  python3 -m http.server 8000
  ```
  Then open: `http://localhost:8000` (or `http://localhost:8000/index.html`).

- **On the web:** Upload `index.html` (and only that file) to any static host (GitHub Pages, Netlify, S3, etc.). The form will POST to your Apps Script URL from the user’s browser.

### 4. Test a submission

1. Fill at least the required fields through the 9 steps.
2. Sign in the signature box.
3. Click **Submit Application**.
4. Check the Google Sheet: a new row should appear with the submitted data.

---

## Form Overview (index.html)

- **Sections (steps):**  
  Borrower info → Income → Monthly obligations → Debt payments → Assets → Liabilities → Property details (×3) → Documents & signature → Review & submit.

- **Behaviour:**
  - Progress bar: “Step X of 9”.
  - Previous / Next between steps; required-field validation before advancing; inline error messages (no `alert()`).
  - Dollar fields: `inputmode="decimal"`, comma formatting on blur, live totals.
  - Totals and ratios (e.g. DTI, net worth, equity, LTV) are computed in the browser and sent in the payload; the sheet stores what the form sends.

- **Submission:**  
  All data + signature image (base64 PNG) are sent as JSON in the POST body. On success the form is replaced by a short confirmation message; on failure a message and **Retry Submission** are shown without clearing data.

---

## Backend Overview (appscript.js)

- **Runtime:** Google Apps Script (JavaScript on Google’s servers). Not Node.js and not run from this folder.
- **Entry point:** `doPost(e)` — Google calls this for each HTTP POST to your Web App URL.
- **Input:** `e.postData.contents` is the raw request body (JSON string).
- **Action:** Parse JSON, build one row in the same order as in the script, append it to the active sheet.
- **Output:** JSON response `{ result: "success" }` or `{ result: "error", message: "..." }` with `Content-Type: application/json`.

Keeping `appscript.js` in this folder is for documentation and version control; the live backend is always the deployed Web App in your Google account.

---

## Optional: Email on New Submission

In the Apps Script editor, uncomment and edit this line in `doPost`:

```javascript
// MailApp.sendEmail("yourfriend@email.com", "New Surecap Application", "New submission from: " + data.name);
```

Replace the email with the address that should receive the alert. The first time you use `MailApp`, Google may ask for additional authorization.

---

## Summary

- **Same folder:** `index.html`, `appscript.js`, and `README.md` all live in this directory; `appscript.js` is here for reference and version control.
- **Run the form:** Open or serve `index.html` after setting `APPS_SCRIPT_URL` to your deployed Web App URL.
- **Run the backend:** You don’t run `appscript.js` locally; you deploy it as a Web App from the Apps Script editor; the form then talks to that URL to save submissions to your Google Sheet.
