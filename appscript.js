/**
 * Surecap Finance — Google Apps Script Web App Backend
 *
 * Paste this entire file into: Google Sheet → Extensions → Apps Script
 * Deploy as a Web App → use the URL as APPS_SCRIPT_URL in index.html
 *
 * What this does:
 *   POST { type: "upload", ... }  → saves file to Google Drive, returns link
 *   POST { type: "submit", ... }  → appends row to Sheet, sends emails
 */

// ─────────────────────────────────────────
// CONFIGURE THESE BEFORE DEPLOYING
// ─────────────────────────────────────────
var LENDER_EMAIL  = "isafariapp@gmail.com";
var COMPANY_NAME  = "Surecap Finance";
var REPLY_TO      = "isafariapp@gmail.com";
var DRIVE_ROOT    = "Surecap Applications"; // top-level Drive folder name
// ─────────────────────────────────────────

// ── Router ──────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.type === "upload") return handleFileUpload(data);
    return handleFormSubmit(data);
  } catch (err) {
    return jsonResponse({ result: "error", message: err.toString() });
  }
}

// ── File Upload Handler ──────────────────────────────────────────────────────
function handleFileUpload(data) {
  try {
    var rootFolder = getOrCreateFolder(DRIVE_ROOT, DriveApp.getRootFolder());

    var folder;
    if (data.folderId) {
      // Reuse existing applicant folder
      folder = DriveApp.getFolderById(data.folderId);
    } else {
      // First upload for this applicant — create their folder
      var folderName = sanitizeName(data.applicantName || "Unknown") + " — " + (data.submissionDate || today());
      folder = getOrCreateFolder(folderName, rootFolder);
    }

    // Decode base64 and save to Drive
    var decoded = Utilities.base64Decode(data.base64Data);
    var blob    = Utilities.newBlob(decoded, data.mimeType || "application/octet-stream", data.fileName || "document");
    var file    = folder.createFile(blob);

    // File stays private (owner-only) — no setSharing call
    var fileLink   = "https://drive.google.com/file/d/" + file.getId() + "/view";
    var folderLink = "https://drive.google.com/drive/folders/" + folder.getId();

    return jsonResponse({
      result:     "success",
      fileId:     file.getId(),
      fileLink:   fileLink,
      folderId:   folder.getId(),
      folderLink: folderLink
    });

  } catch (err) {
    return jsonResponse({ result: "error", message: "Upload failed: " + err.toString() });
  }
}

// ── Form Submit Handler ──────────────────────────────────────────────────────
function handleFormSubmit(data) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    var dl = data.docLinks || {};

    var row = [
      new Date().toLocaleString(),
      // Section 1
      data.name, data.address, data.cellPhone, data.otherPhone, data.email,
      data.employerName, data.employerAddress, data.yearsEmployed,
      data.employmentType, data.compensationType, data.employerPhone, data.employerEmail,
      // Section 2
      data.income1Source, data.income1Amount,
      data.income2Source, data.income2Amount,
      data.income3Source, data.income3Amount,
      data.investmentIncome, data.totalGrossIncome,
      // Section 3
      data.housing, data.propertyTaxes, data.condoFees, data.insurance,
      data.heating, data.alimony, data.childSupport, data.otherObligations,
      data.totalMonthlyObligations,
      // Section 4
      data.creditCards, data.personalLoan, data.autoLoan, data.studentLoan,
      data.surecapLoanInterest, data.totalDebtExpenses, data.dti,
      // Section 5
      data.stocksInvestments, data.prop1Value, data.prop2Value, data.prop3Value,
      data.otherAssets, data.totalAssets,
      // Section 6
      data.ccDebt, data.lineOfCredit, data.personalLoansLiab,
      data.mortgage1, data.mortgage2, data.mortgage3, data.totalDebt, data.netWorth,
      // Section 7
      data.prop1Address, data.prop1MarketValue, data.prop1Mortgage, data.prop1Equity, data.prop1LTV,
      data.prop2Address, data.prop2MarketValue, data.prop2Mortgage, data.prop2Equity, data.prop2LTV,
      data.prop3Address, data.prop3MarketValue, data.prop3Mortgage, data.prop3Equity, data.prop3LTV,
      // Section 8 — one column per doc type + Drive folder link
      dl.utilities        || "—",
      dl.pay_stubs        || "—",
      dl.gov_assessments  || "—",
      dl.tax_bills        || "—",
      dl.condo_fees       || "—",
      dl.loan_contracts   || "—",
      dl.credit_report    || "—",
      data.folderLink     || "—",
      // Signature
      data.submissionDate, data.borrowerNameSigned, data.signatureImage
    ];

    // Sanity check — should always be 77. If not, headers/row are out of sync.
    Logger.log("Row length: " + row.length + " (expected 77)");

    sheet.appendRow(row);

    // Email the lender
    var dtiNum  = parseFloat(data.dti)      || 0;
    var dtiFlag = dtiNum > 43 ? "⚠️ HIGH DTI" : dtiNum > 36 ? "⚠️ ELEVATED DTI" : "✅ ACCEPTABLE DTI";
    var nwNum   = parseFloat(data.netWorth) || 0;
    var nwFlag  = nwNum < 0 ? "⚠️ NEGATIVE NET WORTH" : "✅ POSITIVE NET WORTH";

    var uploadedDocs = Object.keys(dl).map(function(k) { return "  • " + k.replace(/_/g, " ") + ": " + dl[k]; }).join("\n") || "  None uploaded";

    var lenderBody = [
      "New application received on " + new Date().toLocaleString(), "",
      "═══════════════════════════════",
      "  APPLICANT", "═══════════════════════════════",
      "Name   : " + data.name,
      "Email  : " + data.email,
      "Phone  : " + data.cellPhone,
      "Address: " + data.address, "",
      "Employer  : " + data.employerName,
      "Type      : " + data.employmentType + " / " + data.compensationType,
      "Years     : " + data.yearsEmployed, "",
      "═══════════════════════════════",
      "  CREDIT RISK", "═══════════════════════════════",
      "Total Gross Monthly Income : $" + fmt(data.totalGrossIncome),
      "Total Monthly Obligations  : $" + fmt(data.totalMonthlyObligations),
      "Total Debt Expenses        : $" + fmt(data.totalDebtExpenses),
      "DTI Ratio                  : " + data.dti + "%  " + dtiFlag, "",
      "Total Assets   : $" + fmt(data.totalAssets),
      "Total Debt     : $" + fmt(data.totalDebt),
      "Net Worth      : $" + fmt(data.netWorth) + "  " + nwFlag, "",
      "═══════════════════════════════",
      "  UPLOADED DOCUMENTS", "═══════════════════════════════",
      uploadedDocs,
      data.folderLink ? "\nDrive Folder: " + data.folderLink : "", "",
      "Full data is in your Google Sheet.",
    ].join("\n");

    MailApp.sendEmail({ to: LENDER_EMAIL, subject: "[" + COMPANY_NAME + "] New application — " + data.name, body: lenderBody, replyTo: data.email });

    // Confirmation to applicant
    if (data.email) {
      var applicantBody = [
        "Dear " + data.name + ",", "",
        "Thank you for submitting your loan application to " + COMPANY_NAME + ".",
        "Our team will review your information and contact you shortly.", "",
        "  Submission date            : " + data.submissionDate,
        "  Total gross monthly income : $" + fmt(data.totalGrossIncome),
        "  Debt-to-income ratio       : " + data.dti + "%",
        "  Net worth                  : $" + fmt(data.netWorth), "",
        "Sincerely,",
        COMPANY_NAME + " Team"
      ].join("\n");
      MailApp.sendEmail({ to: data.email, subject: "Your " + COMPANY_NAME + " application has been received", body: applicantBody, replyTo: LENDER_EMAIL });
    }

    return jsonResponse({ result: "success" });

  } catch (err) {
    return jsonResponse({ result: "error", message: err.toString() });
  }
}

// ── One-time setup ───────────────────────────────────────────────────────────
function setupHeaders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  var headers = [
    "Timestamp",
    // Section 1
    "Full Name", "Address", "Cell Phone", "Other Phone", "Email",
    "Employer Name", "Employer Address", "Years with Employer",
    "Employment Type", "Compensation Type", "Employer Phone", "Employer Email",
    // Section 2
    "Income 1 Source", "Income 1 Amount ($)",
    "Income 2 Source", "Income 2 Amount ($)",
    "Income 3 Source", "Income 3 Amount ($)",
    "Investment Income ($)", "Total Gross Monthly Income ($)",
    // Section 3
    "Housing ($)", "Property Taxes ($)", "Condo Fees ($)", "Insurance ($)",
    "Heating ($)", "Alimony ($)", "Child Support ($)", "Other Obligations ($)",
    "Total Monthly Obligations ($)",
    // Section 4
    "CC Min Payment ($)", "Personal Loan ($)", "Auto Loan ($)",
    "Student Loan ($)", "SureCap Interest ($)",
    "Total Debt Expenses ($)", "DTI (%)",
    // Section 5
    "Stocks & Investments ($)", "Prop 1 Value ($)", "Prop 2 Value ($)", "Prop 3 Value ($)",
    "Other Assets ($)", "Total Assets ($)",
    // Section 6
    "CC Debt ($)", "Line of Credit ($)", "Personal Loans ($)",
    "Mortgage Prop 1 ($)", "Mortgage Prop 2 ($)", "Mortgage Prop 3 ($)",
    "Total Debt ($)", "Net Worth ($)",
    // Section 7
    "Prop 1 Address", "Prop 1 Market Value ($)", "Prop 1 Mortgage ($)", "Prop 1 Equity ($)", "Prop 1 LTV (%)",
    "Prop 2 Address", "Prop 2 Market Value ($)", "Prop 2 Mortgage ($)", "Prop 2 Equity ($)", "Prop 2 LTV (%)",
    "Prop 3 Address", "Prop 3 Market Value ($)", "Prop 3 Mortgage ($)", "Prop 3 Equity ($)", "Prop 3 LTV (%)",
    // Section 8 — individual doc columns
    "Doc: Utilities (Link)",
    "Doc: Pay Stubs (Link)",
    "Doc: Gov't Assessments (Link)",
    "Doc: Municipal Tax Bills (Link)",
    "Doc: Condo Fees (Link)",
    "Doc: Loan Contracts (Link)",
    "Doc: Credit Report (Link)",
    "Drive Folder (Link)",
    // Signature
    "Submission Date", "Borrower Name (Signed)", "Signature Image (base64)"
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  sheet.getRange(1, 1, 1, headers.length).setBackground("#1B2A4A");
  sheet.getRange(1, 1, 1, headers.length).setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);

  // Narrow signature column, auto-resize everything else
  var sigColIndex = headers.length;
  sheet.setColumnWidth(sigColIndex, 120);
  for (var i = 1; i < sigColIndex; i++) sheet.autoResizeColumn(i);

  Logger.log("Headers set. Total columns: " + headers.length);
}

// ── Test (run from editor) ───────────────────────────────────────────────────
function testDoPost() {
  var fakeData = {
    type: "submit",
    name: "Test User", address: "123 Test St, Montreal, QC H1A 1A1",
    cellPhone: "514-555-0000", otherPhone: "", email: "test@example.com",
    employerName: "Acme Corp", employerAddress: "456 Corp Ave",
    yearsEmployed: "3", employmentType: "Permanent", compensationType: "Salary",
    employerPhone: "514-555-0001", employerEmail: "hr@acme.com",
    income1Source: "Salary", income1Amount: 5000,
    income2Source: "", income2Amount: 0,
    income3Source: "", income3Amount: 0,
    investmentIncome: 200, totalGrossIncome: 5200,
    housing: 1200, propertyTaxes: 200, condoFees: 0, insurance: 100,
    heating: 80, alimony: 0, childSupport: 0, otherObligations: 0, totalMonthlyObligations: 1580,
    creditCards: 150, personalLoan: 0, autoLoan: 400, studentLoan: 200,
    surecapLoanInterest: 0, totalDebtExpenses: 750, dti: "44.8",
    stocksInvestments: 10000, prop1Value: 350000, prop2Value: 0, prop3Value: 0,
    otherAssets: 5000, totalAssets: 365000,
    ccDebt: 3000, lineOfCredit: 5000, personalLoansLiab: 0,
    mortgage1: 280000, mortgage2: 0, mortgage3: 0, totalDebt: 288000, netWorth: 77000,
    prop1Address: "123 Test St, Montreal", prop1MarketValue: 350000, prop1Mortgage: 280000, prop1Equity: 70000, prop1LTV: "80.0",
    prop2Address: "", prop2MarketValue: 0, prop2Mortgage: 0, prop2Equity: 0, prop2LTV: "",
    prop3Address: "", prop3MarketValue: 0, prop3Mortgage: 0, prop3Equity: 0, prop3LTV: "",
    docLinks: { pay_stubs: "https://drive.google.com/file/d/TESTID/view", credit_report: "https://drive.google.com/file/d/TESTID2/view" },
    folderLink: "https://drive.google.com/drive/folders/TESTFOLDERID",
    submissionDate: "2026-03-05", borrowerNameSigned: "Test User",
    signatureImage: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  };
  var result = handleFormSubmit(fakeData);
  Logger.log("Result: " + result.getContent());
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getOrCreateFolder(name, parent) {
  var folders = parent.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(name);
}

function sanitizeName(name) {
  return name.replace(/[\/\\:*?"<>|]/g, "_").substring(0, 60);
}

function today() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function fmt(value) {
  var num = parseFloat(value) || 0;
  return num.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
