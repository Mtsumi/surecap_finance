/**
 * Surecap Finance — Google Apps Script Web App Backend
 *
 * Paste this entire file into: Google Sheet → Extensions → Apps Script
 * Deploy as a Web App → use the URL as APPS_SCRIPT_URL in index.html
 *
 * What this does:
 *   POST { type: "upload", ... }  → saves file to Google Drive, returns link
 *   POST { type: "submit", ... }  → appends row to Sheet, builds PDF, sends emails
 */

// ─────────────────────────────────────────
// CONFIGURE THESE BEFORE DEPLOYING
// ─────────────────────────────────────────
var LENDER_EMAIL  = "isafariapp@gmail.com";
var COMPANY_NAME  = "Surecap Finance";
var REPLY_TO      = "isafariapp@gmail.com";
var DRIVE_ROOT    = "Surecap Applications"; // top-level Drive folder name

// Upload "Surecap logo EN.png" to Google Drive, open it, copy the ID from
// the URL (drive.google.com/file/d/THIS_PART/view) and paste it below.
var LOGO_FILE_ID  = "";  // e.g. "1aBcDeFgHiJkLmNoPqRsTuVwXyZ"
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
      folder = DriveApp.getFolderById(data.folderId);
    } else {
      var folderName = sanitizeName(data.applicantName || "Unknown") + " — " + (data.submissionDate || today());
      folder = getOrCreateFolder(folderName, rootFolder);
    }

    var decoded = Utilities.base64Decode(data.base64Data);
    var blob    = Utilities.newBlob(decoded, data.mimeType || "application/octet-stream", data.fileName || "document");
    var file    = folder.createFile(blob);

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
    var dl    = data.docLinks || {};

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
      // Section 8 — individual doc columns + selfie + folder
      dl.utilities        || "—",
      dl.pay_stubs        || "—",
      dl.gov_assessments  || "—",
      dl.tax_bills        || "—",
      dl.condo_fees       || "—",
      dl.loan_contracts   || "—",
      dl.credit_report    || "—",
      data.selfieLink     || "—",
      data.folderLink     || "—",
      // Signature
      data.submissionDate, data.borrowerNameSigned, data.signatureImage
    ];

    // Sanity check — should always be 78. If not, headers/row are out of sync.
    Logger.log("Row length: " + row.length + " (expected 78)");
    sheet.appendRow(row);

    // ── Build PDF (non-blocking — data is already saved if this fails) ──────
    var pdfBlob       = null;
    var docAttachments = [];

    try {
      var appDoc = buildApplicationDoc(data);
      pdfBlob = appDoc.getAs("application/pdf")
                      .setName((data.name || "Applicant") + " — Surecap Application.pdf");

      // Move the Google Doc into the applicant's Drive folder
      if (data.folderLink) {
        var folderId = fileIdFromLink(data.folderLink);
        if (folderId) {
          try { DriveApp.getFileById(appDoc.getId()).moveTo(DriveApp.getFolderById(folderId)); }
          catch (moveErr) { Logger.log("Doc move failed: " + moveErr); }
        }
      }

      // Collect uploaded supporting docs as separate attachments
      var docTypeLabels = {
        utilities:       "Utilities",
        pay_stubs:       "Pay Stubs",
        gov_assessments: "Gov Assessments",
        tax_bills:       "Tax Bills",
        condo_fees:      "Condo Fees",
        loan_contracts:  "Loan Contracts",
        credit_report:   "Credit Report"
      };
      Object.keys(docTypeLabels).forEach(function(key) {
        var fileId = fileIdFromLink(dl[key]);
        if (!fileId) return;
        try {
          var blob = DriveApp.getFileById(fileId).getBlob();
          blob.setName(docTypeLabels[key] + " — " + (data.name || ""));
          docAttachments.push(blob);
        } catch (fetchErr) { Logger.log("Could not fetch " + key + ": " + fetchErr); }
      });

    } catch (pdfErr) {
      Logger.log("PDF generation failed (submission still saved): " + pdfErr.toString());
    }

    var allAttachments = pdfBlob ? [pdfBlob].concat(docAttachments) : docAttachments;

    // ── Email the lender ────────────────────────────────────────────────────
    var dtiNum  = parseFloat(data.dti)      || 0;
    var dtiFlag = dtiNum > 43 ? "⚠️ HIGH DTI" : dtiNum > 36 ? "⚠️ ELEVATED DTI" : "✅ ACCEPTABLE DTI";
    var nwNum   = parseFloat(data.netWorth) || 0;
    var nwFlag  = nwNum < 0 ? "⚠️ NEGATIVE NET WORTH" : "✅ POSITIVE NET WORTH";

    var uploadedDocs = Object.keys(dl)
      .filter(function(k) { return k !== "selfie"; })
      .map(function(k) { return "  • " + k.replace(/_/g, " ") + ": " + dl[k]; })
      .join("\n") || "  None uploaded";

    var lenderBody = [
      "New application received on " + new Date().toLocaleString(),
      pdfBlob ? "Full application PDF is attached." : "⚠️ PDF generation failed — see Google Sheet for full data.", "",
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
      "  CREDIT RISK SUMMARY", "═══════════════════════════════",
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
      data.selfieLink  ? "  • selfie: " + data.selfieLink     : "",
      data.folderLink  ? "\nDrive Folder: " + data.folderLink  : "", "",
      "Full data is also in your Google Sheet.",
    ].join("\n");

    var lenderMailOptions = {
      to:       LENDER_EMAIL,
      subject:  "[" + COMPANY_NAME + "] New application — " + data.name,
      body:     lenderBody,
      replyTo:  data.email
    };
    if (allAttachments.length > 0) lenderMailOptions.attachments = allAttachments;
    MailApp.sendEmail(lenderMailOptions);

    // ── Confirmation to applicant ───────────────────────────────────────────
    if (data.email) {
      var applicantBody = [
        "Dear " + data.name + ",", "",
        "Thank you for submitting your loan application to " + COMPANY_NAME + ".",
        "Please find your completed application form attached to this email for your records.", "",
        "Our team will review your information and contact you shortly.", "",
        "  Submission date            : " + data.submissionDate,
        "  Total gross monthly income : $" + fmt(data.totalGrossIncome),
        "  Debt-to-income ratio       : " + data.dti + "%",
        "  Net worth                  : $" + fmt(data.netWorth), "",
        "Sincerely,",
        COMPANY_NAME + " Team"
      ].join("\n");

      var applicantMailOptions = {
        to:       data.email,
        subject:  "Your " + COMPANY_NAME + " application — confirmation & copy",
        body:     applicantBody,
        replyTo:  LENDER_EMAIL
      };
      if (pdfBlob) applicantMailOptions.attachments = [pdfBlob];
      MailApp.sendEmail(applicantMailOptions);
    }

    return jsonResponse({ result: "success" });

  } catch (err) {
    return jsonResponse({ result: "error", message: err.toString() });
  }
}

// ── Application PDF Builder ──────────────────────────────────────────────────
function buildApplicationDoc(data) {
  var dl       = data.docLinks || {};
  var docTitle = COMPANY_NAME + " — Application — " + sanitizeName(data.name || "Unknown") + " — " + (data.submissionDate || today());
  var doc      = DocumentApp.create(docTitle);
  var body     = doc.getBody();

  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(54).setMarginRight(54);

  // ── Logo ──────────────────────────────────────────────────────────────────
  if (LOGO_FILE_ID) {
    try {
      var logoBlob = DriveApp.getFileById(LOGO_FILE_ID).getBlob();
      body.appendImage(logoBlob).setWidth(170);
      body.appendParagraph("");
    } catch (logoErr) { Logger.log("Logo not loaded: " + logoErr); }
  }

  // ── Cover ─────────────────────────────────────────────────────────────────
  var titleP = body.appendParagraph(COMPANY_NAME.toUpperCase() + " — CREDIT APPLICATION");
  titleP.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  titleP.setAlignment(DocumentApp.HorizontalAlignment.LEFT);

  docField(body, "Submission Date", data.submissionDate);
  docField(body, "Prepared for",    data.name);
  body.appendParagraph("");

  // ── Section 1: Personal & Employment ─────────────────────────────────────
  docSection(body, "1. Personal & Employment Information");
  docField(body, "Full Name",             data.name);
  docField(body, "Address",               data.address);
  docField(body, "Cell Phone",            data.cellPhone);
  docField(body, "Other Phone",           data.otherPhone);
  docField(body, "Email",                 data.email);
  body.appendParagraph("");
  docField(body, "Employer",              data.employerName);
  docField(body, "Employer Address",      data.employerAddress);
  docField(body, "Years with Employer",   data.yearsEmployed);
  docField(body, "Employment Type",       data.employmentType);
  docField(body, "Compensation Type",     data.compensationType);
  docField(body, "Employer Phone",        data.employerPhone);
  docField(body, "Employer Email",        data.employerEmail);

  // ── Section 2: Income ────────────────────────────────────────────────────
  docSection(body, "2. Income");
  if (data.income1Source || data.income1Amount) docField(body, "Income Source 1", data.income1Source + " — $" + fmt(data.income1Amount));
  if (data.income2Source || data.income2Amount) docField(body, "Income Source 2", data.income2Source + " — $" + fmt(data.income2Amount));
  if (data.income3Source || data.income3Amount) docField(body, "Income Source 3", data.income3Source + " — $" + fmt(data.income3Amount));
  docField(body, "Investment Income",             "$" + fmt(data.investmentIncome));
  docField(body, "Total Gross Monthly Income",    "$" + fmt(data.totalGrossIncome));

  // ── Section 3: Monthly Obligations ───────────────────────────────────────
  docSection(body, "3. Monthly Obligations");
  docField(body, "Housing",                 "$" + fmt(data.housing));
  docField(body, "Property Taxes",          "$" + fmt(data.propertyTaxes));
  docField(body, "Condo Fees",              "$" + fmt(data.condoFees));
  docField(body, "Insurance",               "$" + fmt(data.insurance));
  docField(body, "Heating",                 "$" + fmt(data.heating));
  docField(body, "Alimony",                 "$" + fmt(data.alimony));
  docField(body, "Child Support",           "$" + fmt(data.childSupport));
  docField(body, "Other Obligations",       "$" + fmt(data.otherObligations));
  docField(body, "Total Monthly Obligations","$" + fmt(data.totalMonthlyObligations));

  // ── Section 4: Debt Expenses & DTI ───────────────────────────────────────
  docSection(body, "4. Debt Expenses & Debt-to-Income");
  docField(body, "Credit Card Minimum",     "$" + fmt(data.creditCards));
  docField(body, "Personal Loan",           "$" + fmt(data.personalLoan));
  docField(body, "Auto Loan",               "$" + fmt(data.autoLoan));
  docField(body, "Student Loan",            "$" + fmt(data.studentLoan));
  docField(body, "SureCap Loan Interest",   "$" + fmt(data.surecapLoanInterest));
  docField(body, "Total Debt Expenses",     "$" + fmt(data.totalDebtExpenses));
  docField(body, "Debt-to-Income Ratio",    (data.dti || "—") + "%");

  // ── Section 5: Assets ────────────────────────────────────────────────────
  docSection(body, "5. Assets");
  docField(body, "Stocks & Investments",    "$" + fmt(data.stocksInvestments));
  docField(body, "Property 1 Value",        "$" + fmt(data.prop1Value));
  if (data.prop2Value) docField(body, "Property 2 Value", "$" + fmt(data.prop2Value));
  if (data.prop3Value) docField(body, "Property 3 Value", "$" + fmt(data.prop3Value));
  docField(body, "Other Assets",            "$" + fmt(data.otherAssets));
  docField(body, "Total Assets",            "$" + fmt(data.totalAssets));

  // ── Section 6: Liabilities ───────────────────────────────────────────────
  docSection(body, "6. Liabilities");
  docField(body, "Credit Card Debt",        "$" + fmt(data.ccDebt));
  docField(body, "Line of Credit",          "$" + fmt(data.lineOfCredit));
  docField(body, "Personal Loans",          "$" + fmt(data.personalLoansLiab));
  docField(body, "Mortgage — Property 1",   "$" + fmt(data.mortgage1));
  if (data.mortgage2) docField(body, "Mortgage — Property 2", "$" + fmt(data.mortgage2));
  if (data.mortgage3) docField(body, "Mortgage — Property 3", "$" + fmt(data.mortgage3));
  docField(body, "Total Debt",              "$" + fmt(data.totalDebt));
  docField(body, "Net Worth",               "$" + fmt(data.netWorth));

  // ── Section 7: Property Details ──────────────────────────────────────────
  var propData = [
    { addr: data.prop1Address, market: data.prop1MarketValue, mort: data.prop1Mortgage, equity: data.prop1Equity, ltv: data.prop1LTV },
    { addr: data.prop2Address, market: data.prop2MarketValue, mort: data.prop2Mortgage, equity: data.prop2Equity, ltv: data.prop2LTV },
    { addr: data.prop3Address, market: data.prop3MarketValue, mort: data.prop3Mortgage, equity: data.prop3Equity, ltv: data.prop3LTV }
  ];
  var hasProps = propData.some(function(p) { return p.addr || p.market; });
  if (hasProps) {
    docSection(body, "7. Property Details");
    propData.forEach(function(p, i) {
      if (!p.addr && !p.market) return;
      var pLabel = body.appendParagraph("Property " + (i + 1));
      pLabel.setFontSize(10);
      pLabel.editAsText().setBold(true);
      docField(body, "Address",      p.addr);
      docField(body, "Market Value", "$" + fmt(p.market));
      docField(body, "Mortgage",     "$" + fmt(p.mort));
      docField(body, "Equity",       "$" + fmt(p.equity));
      docField(body, "LTV",          (p.ltv || "—") + "%");
      body.appendParagraph("");
    });
  }

  // ── Section 8: Supporting Documents ──────────────────────────────────────
  docSection(body, "8. Supporting Documents");
  var docTypeMap = {
    utilities:       "Utilities",
    pay_stubs:       "Pay Stubs / Proof of Income",
    gov_assessments: "Government Assessments (3 years)",
    tax_bills:       "Municipal Tax Bills",
    condo_fees:      "Condo Fee Statements",
    loan_contracts:  "Existing Loan Contracts",
    credit_report:   "Credit Report"
  };
  Object.keys(docTypeMap).forEach(function(key) {
    var link = dl[key];
    if (!link || link === "—") {
      docField(body, docTypeMap[key], "Not uploaded");
      return;
    }
    var fileId = fileIdFromLink(link);
    var embedded = false;
    if (fileId) {
      try {
        var docFile = DriveApp.getFileById(fileId);
        var mime    = docFile.getMimeType();
        if (mime && mime.indexOf("image/") === 0) {
          // Embed image files directly
          var imgLabel = body.appendParagraph(docTypeMap[key] + ":");
          imgLabel.setFontSize(10);
          imgLabel.editAsText().setBold(0, docTypeMap[key].length, true);
          body.appendImage(docFile.getBlob()).setWidth(350);
          embedded = true;
        }
      } catch (imgErr) { /* fall through to link */ }
    }
    if (!embedded) docField(body, docTypeMap[key], link);
  });

  if (data.folderLink) docField(body, "Drive Folder (all files)", data.folderLink);

  // ── Section 9: Identity Verification ─────────────────────────────────────
  docSection(body, "9. Identity Verification (Selfie)");
  var selfieEmbedded = false;
  if (data.selfieLink && data.selfieLink !== "—") {
    var selfieId = fileIdFromLink(data.selfieLink);
    if (selfieId) {
      try {
        body.appendImage(DriveApp.getFileById(selfieId).getBlob()).setWidth(200);
        selfieEmbedded = true;
      } catch (selfieErr) { Logger.log("Selfie embed failed: " + selfieErr); }
    }
  }
  if (!selfieEmbedded) {
    docField(body, "Selfie", data.selfieLink || "Not captured");
  }

  // ── Section 10: Declaration & Signature ──────────────────────────────────
  docSection(body, "10. Borrower Declaration & Signature");
  var declaration = body.appendParagraph(
    "I, " + (data.borrowerNameSigned || data.name || "") +
    ", declare that all information provided in this application is accurate and complete to the best of my knowledge."
  );
  declaration.setFontSize(10);
  declaration.setItalic(true);
  body.appendParagraph("");

  if (data.signatureImage) {
    try {
      var sigBase64 = data.signatureImage.replace(/^data:[^;]+;base64,/, "");
      var sigBlob   = Utilities.newBlob(Utilities.base64Decode(sigBase64), "image/png", "signature.png");
      body.appendImage(sigBlob).setWidth(280);
    } catch (sigErr) { Logger.log("Signature embed failed: " + sigErr); }
  }
  body.appendParagraph("");
  docField(body, "Signed by", data.borrowerNameSigned);
  docField(body, "Date",      data.submissionDate);

  doc.saveAndClose();
  return doc;
}

// ── Doc helper: section heading ──────────────────────────────────────────────
function docSection(body, title) {
  var p = body.appendParagraph(title);
  p.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  p.setSpacingBefore(18);
  p.setSpacingAfter(4);
  return p;
}

// ── Doc helper: bold label + plain value on one line ────────────────────────
function docField(body, label, value) {
  var valueStr = (value !== null && value !== undefined && String(value) !== "") ? String(value) : "—";
  var fullText = label + ":  " + valueStr;
  var p        = body.appendParagraph(fullText);
  p.setFontSize(10);
  p.setSpacingAfter(2);
  // Bold just the label
  var labelEnd = (label + ":  ").length - 1;
  p.editAsText().setBold(0, labelEnd, true);
  if (fullText.length > labelEnd + 1) {
    p.editAsText().setBold(labelEnd + 1, fullText.length - 1, false);
  }
  return p;
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
    "Identity Selfie (Link)",
    "Drive Folder (Link)",
    // Signature
    "Submission Date", "Borrower Name (Signed)", "Signature Image (base64)"
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  sheet.getRange(1, 1, 1, headers.length).setBackground("#1B2A4A");
  sheet.getRange(1, 1, 1, headers.length).setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);

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
    selfieLink: "https://drive.google.com/file/d/TESTSELFIEID/view",
    folderLink: "https://drive.google.com/drive/folders/TESTFOLDERID",
    submissionDate: "2026-03-03", borrowerNameSigned: "Test User",
    signatureImage: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  };
  var result = handleFormSubmit(fakeData);
  Logger.log("Result: " + result.getContent());
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fileIdFromLink(link) {
  if (!link || link === "—") return null;
  // Matches /d/FILE_ID/ (file links) and /folders/FOLDER_ID (folder links)
  var m = link.match(/\/d\/([\w-]+)\//) || link.match(/\/folders\/([\w-]+)/);
  return m ? m[1] : null;
}

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
