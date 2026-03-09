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


var LOGO_FILE_ID  = "https://drive.google.com/file/d/1XQaUeDdRfLhkYIAhi9BFkddSLwO9Y7_k/view";  // e.g. "1aBcDeFgHiJkLmNoPqRsTuVwXyZ"
// ─────────────────────────────────────────

// ── Router ──────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.type === "upload") return handleFileUpload(data);
    // Docuseal webhook: by event_type or by payload shape (data.data.id + submitters)
    if (data.type === "signed") return handleDocusealWebhook(data);
    if (data.event_type && String(data.event_type).indexOf("submission") !== -1) return handleDocusealWebhook(data);
    if (data.data && (data.data.id != null || data.data.submission_id) && (data.data.submitters || data.data.submitter)) return handleDocusealWebhook(data);
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

// ── Docuseal: one-shot submission from PDF (no template step), return slug ───
function createDocusealSubmission(pdfBlob, applicantEmail, applicantName, applicantPhone) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("DOCUSEAL_API_KEY");
  if (!apiKey || apiKey.trim() === "") throw new Error("DOCUSEAL_API_KEY is not set. Add it in Apps Script: Project Settings → Script properties.");
  var base64Pdf = Utilities.base64Encode(pdfBlob.getBytes());

  // POST /submissions/pdf — one-off submission from PDF (avoids template + Pro plan requirement)
  var res = UrlFetchApp.fetch("https://api.docuseal.com/submissions/pdf", {
    method: "post",
    headers: { "X-Auth-Token": apiKey, "Content-Type": "application/json" },
    payload: JSON.stringify({
      name: "Loan Agreement - " + applicantName,
      send_email: false,
      documents: [{ name: "loan_agreement", file: base64Pdf }],
      submitters: [{
        email: applicantEmail,
        name: applicantName,
        role: "Borrower",
        send_email: false,
        phone: applicantPhone || "",
        require_phone_2fa: !!(applicantPhone && applicantPhone.trim())
      }]
    }),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText();

  if (code < 200 || code >= 300) throw new Error("Docuseal API error " + code + ": " + body);

  var data = JSON.parse(body);
  var submitter = (data.submitters && data.submitters[0]) ? data.submitters[0] : null;
  var slug = submitter ? submitter.slug : null;
  var submissionId = data.id != null ? data.id : (submitter ? submitter.submission_id : null);

  if (!slug) throw new Error("Docuseal submission missing slug: " + body);

  return { slug: slug, submissionId: submissionId };
}

// ── Run from Apps Script editor to test Docuseal API (View → Logs after run) ───
function testDocusealConnection() {
  var apiKey = PropertiesService.getScriptProperties().getProperty("DOCUSEAL_API_KEY");
  Logger.log("=== Docuseal API test ===");
  Logger.log("DOCUSEAL_API_KEY present: " + (!!apiKey && apiKey.length > 0));
  if (!apiKey || apiKey.trim() === "") {
    Logger.log("FAIL: Add DOCUSEAL_API_KEY in Project Settings → Script properties.");
    return;
  }

  var headers = { "X-Auth-Token": apiKey };

  // Step 1: Verify API key with GET /submissions (list)
  try {
    var listRes = UrlFetchApp.fetch("https://api.docuseal.com/submissions?limit=1", {
      method: "get",
      headers: headers,
      muteHttpExceptions: true
    });
    var listCode = listRes.getResponseCode();
    Logger.log("GET /submissions → " + listCode);
    if (listCode === 401) {
      Logger.log("FAIL: Invalid or expired API key (401 Unauthorized).");
      return;
    }
    if (listCode !== 200) {
      Logger.log("GET response: " + listRes.getContentText().substring(0, 300));
    }
  } catch (e) {
    Logger.log("GET error: " + e.toString());
  }

  // Step 2: Try POST /submissions/pdf with a minimal PDF
  var minimalPdfBase64 = "JVBERi0xLjQKJcOkw7zDtsOcCjIgMCBvYmoKPDwKL0xlbmd0aCAzIDAgUgovVHlwZSAvUGFnZQovUGFyZW50IDQgMCBSCj4+CnN0cmVhbQp4nCk=";

  try {
    var res = UrlFetchApp.fetch("https://api.docuseal.com/submissions/pdf", {
      method: "post",
      headers: { "X-Auth-Token": apiKey, "Content-Type": "application/json" },
      payload: JSON.stringify({
        name: "Test - Surecap",
        send_email: false,
        documents: [{ name: "test", file: minimalPdfBase64 }],
        submitters: [{ email: "test@example.com", name: "Test", role: "Borrower", send_email: false }]
      }),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    var body = res.getContentText();
    Logger.log("POST /submissions/pdf → " + code);
    Logger.log("Response body (first 600 chars): " + (body.length > 600 ? body.substring(0, 600) + "..." : body));

    if (code >= 200 && code < 300) {
      var data = JSON.parse(body);
      var slug = data.submitters && data.submitters[0] ? data.submitters[0].slug : null;
      Logger.log("SUCCESS. Slug: " + slug + ", Submission id: " + data.id);
    } else {
      Logger.log("FAIL: Check message above. Common: 401=bad key, 403=plan limit, 422=invalid PDF or params.");
    }
  } catch (e) {
    Logger.log("POST ERROR: " + e.toString());
  }
}

// ── Form Submit Handler ──────────────────────────────────────────────────────
function handleFormSubmit(data) {
  try {
    // Reject webhooks or empty payloads — never write or email with undefined applicant data
    var hasApplicant = (data.name && String(data.name).trim()) || (data.email && String(data.email).trim());
    if (!hasApplicant) {
      Logger.log("handleFormSubmit: missing name/email — possible webhook or bad payload. Keys: " + Object.keys(data).join(","));
      return jsonResponse({ result: "error", message: "Missing applicant name or email." });
    }

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
      // Section 8 — individual doc columns (multiple links newline-separated)
      (docLinksArray(dl.utilities).join("\n")        || "—"),
      (docLinksArray(dl.pay_stubs).join("\n")       || "—"),
      (docLinksArray(dl.gov_assessments).join("\n")  || "—"),
      (docLinksArray(dl.tax_bills).join("\n")       || "—"),
      (docLinksArray(dl.condo_fees).join("\n")      || "—"),
      (docLinksArray(dl.loan_contracts).join("\n")  || "—"),
      (docLinksArray(dl.credit_report).join("\n")   || "—"),
      data.selfieLink     || "—",
      data.folderLink     || "—",
      // Signature
      data.submissionDate, data.borrowerNameSigned, data.signatureImage
    ];

    // Sanity check — should always be 78. If not, headers/row are out of sync.
    Logger.log("Row length: " + row.length + " (expected 78)");
    sheet.appendRow(row);

    // ── Build PDF (non-blocking — data is already saved if this fails) ──────
    var pdfBlob        = null;
    var docAttachments = [];
    var pdfErrorMsg    = null;

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
        var links = docLinksArray(dl[key]);
        links.slice(0, 5).forEach(function(link, idx) {
          var fileId = fileIdFromLink(link);
          if (!fileId) return;
          try {
            var blob = DriveApp.getFileById(fileId).getBlob();
            blob.setName(links.length > 1 ? docTypeLabels[key] + " " + (idx + 1) + " — " + (data.name || "") : docTypeLabels[key] + " — " + (data.name || ""));
            docAttachments.push(blob);
          } catch (fetchErr) { Logger.log("Could not fetch " + key + ": " + fetchErr); }
        });
      });

    } catch (pdfErr) {
      pdfErrorMsg = pdfErr.toString();
      Logger.log("PDF generation failed (submission still saved): " + pdfErrorMsg);
    }

    var allAttachments = pdfBlob ? [pdfBlob].concat(docAttachments) : docAttachments;

    var applicantBody = [
      "Dear " + data.name + ",", "",
      "Thank you for submitting your loan application to " + COMPANY_NAME + ".",
      "Please find your completed application form attached to this email for your records.", "",
      "Our team will review your information and contact you shortly.", "",
      "Sincerely,",
      COMPANY_NAME + " Team"
    ].join("\n");

    // Send to Docuseal for signing — do not email yet, wait for webhook
    if (pdfBlob) {
      try {
        var phone = formatE164(data.cellPhone || "");
        var docusealResult = createDocusealSubmission(pdfBlob, data.email, data.name, phone);
        var lastRow = sheet.getLastRow();
        sheet.getRange(lastRow, row.length + 1).setValue(docusealResult.submissionId);
        sheet.getRange(lastRow, row.length + 2).setValue("Pending Signature");

        return jsonResponse({ result: "success", signing_slug: docusealResult.slug, _v: "docuseal" });
      } catch (docusealErr) {
        Logger.log("Docuseal error: " + docusealErr);
        // Fallback: send unsigned PDF by email so submission is never lost
        if (data.email) {
          MailApp.sendEmail({
            to:       data.email,
            subject:  "Your " + COMPANY_NAME + " application — confirmation & copy",
            body:     applicantBody,
            replyTo:  LENDER_EMAIL,
            attachments: [pdfBlob]
          });
        }
        return jsonResponse({ result: "success", signing_slug: null, warning: "Signing unavailable, PDF sent directly.", _v: "docuseal" });
      }
    }

    // No PDF — notify lender only (existing fallback)
    var dtiNum  = parseFloat(data.dti)      || 0;
    var dtiFlag = dtiNum > 43 ? "⚠️ HIGH DTI" : dtiNum > 36 ? "⚠️ ELEVATED DTI" : "✅ ACCEPTABLE DTI";
    var nwNum   = parseFloat(data.netWorth) || 0;
    var nwFlag  = nwNum < 0 ? "⚠️ NEGATIVE NET WORTH" : "✅ POSITIVE NET WORTH";

    var uploadedDocs = Object.keys(dl)
      .filter(function(k) { return k !== "selfie"; })
      .map(function(k) {
        var links = docLinksArray(dl[k]);
        return "  • " + k.replace(/_/g, " ") + ": " + (links.length ? links.join(", ") : "—");
      })
      .join("\n") || "  None uploaded";

    var lenderBody = [
      "New application received on " + new Date().toLocaleString(),
      "⚠️ PDF generation failed — see Google Sheet for full data.\n   Error: " + pdfErrorMsg, "",
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

    if (data.email) {
      var applicantMailOptions = {
        to:       data.email,
        subject:  "Your " + COMPANY_NAME + " application — confirmation & copy",
        body:     applicantBody,
        replyTo:  LENDER_EMAIL
      };
      MailApp.sendEmail(applicantMailOptions);
    }

    return jsonResponse({ result: "success", _v: "docuseal" });

  } catch (err) {
    return jsonResponse({ result: "error", message: err.toString() });
  }
}

// ── Docuseal webhook: submission.completed → email signed PDF, update sheet ──
function handleDocusealWebhook(data) {
  var submissionId = data.data && data.data.id != null ? data.data.id : data.submission_id;
  var signerEmail  = (data.data && data.data.submitters && data.data.submitters[0])
    ? data.data.submitters[0].email
    : (data.email || (data.data && data.data.submitters && data.data.submitters[0] ? data.data.submitters[0].email : null));

  if (!submissionId) {
    Logger.log("Docuseal webhook missing submission id: " + JSON.stringify(data));
    return jsonResponse({ result: "error", message: "Missing submission id" });
  }

  var apiKey = PropertiesService.getScriptProperties().getProperty("DOCUSEAL_API_KEY");
  var subRes = UrlFetchApp.fetch("https://api.docuseal.com/submissions/" + submissionId, {
    headers: { "X-Auth-Token": apiKey },
    muteHttpExceptions: true
  });
  var subData = JSON.parse(subRes.getContentText());
  var docUrl = (subData.documents && subData.documents[0] && subData.documents[0].url)
    ? subData.documents[0].url
    : (subData.combined_document_url || subData.document_url || null);
  if (!docUrl) {
    Logger.log("No signed document URL in submission: " + subRes.getContentText().substring(0, 500));
    return jsonResponse({ result: "error", message: "No document URL" });
  }

  if (!signerEmail && subData.submitters && subData.submitters[0]) signerEmail = subData.submitters[0].email;

  var pdfResponse = UrlFetchApp.fetch(docUrl, { muteHttpExceptions: true });
  var signedPdfBlob = pdfResponse.getBlob().setName("Signed_Loan_Application.pdf");

  var signedBody = "Dear Applicant,\n\nThank you for completing your loan application with " + COMPANY_NAME + ".\n\nPlease find your signed loan agreement attached. Our team will be in touch shortly.\n\nSincerely,\n" + COMPANY_NAME + " Team";

  if (signerEmail) {
    MailApp.sendEmail({
      to:       signerEmail,
      subject:  "Your " + COMPANY_NAME + " loan application — signed copy",
      body:     signedBody,
      replyTo:  LENDER_EMAIL,
      attachments: [signedPdfBlob]
    });
  }

  MailApp.sendEmail({
    to:       LENDER_EMAIL,
    subject:  "Signed loan application received — " + (signerEmail || "applicant"),
    body:     "A loan application has been signed by " + (signerEmail || "applicant") + ". Please find the signed agreement attached.",
    attachments: [signedPdfBlob]
  });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data2 = sheet.getDataRange().getValues();
  for (var i = 1; i < data2.length; i++) {
    for (var j = 0; j < data2[i].length; j++) {
      if (String(data2[i][j]) === String(submissionId)) {
        sheet.getRange(i + 1, j + 2).setValue("Signed ✓");
        break;
      }
    }
  }

  return jsonResponse({ result: "success" });
}

// ── Application PDF Builder ──────────────────────────────────────────────────
var PDF_LOGO_WIDTH      = 300;  // Logo dominant on cover
var PDF_DOC_IMAGE_WIDTH = 260;  // Section 8 embedded images
var PDF_SELFIE_WIDTH    = 100;   // Keep selfie compact (portrait = tall; small width = less vertical space)
var PDF_SELFIE_HEIGHT   = 100;  // Cap height so selfie isn't "long" in PDF
var PDF_MARGIN_TOP      = 36;
var PDF_MARGIN_BOTTOM   = 36;
var PDF_MARGIN_SIDE     = 54;

function buildApplicationDoc(data) {
  var dl       = data.docLinks || {};
  var docTitle = COMPANY_NAME + " — Application — " + sanitizeName(data.name || "Unknown") + " — " + (data.submissionDate || today());
  var doc      = DocumentApp.create(docTitle);
  var body     = doc.getBody();

  body.setMarginTop(PDF_MARGIN_TOP);
  body.setMarginBottom(PDF_MARGIN_BOTTOM);
  body.setMarginLeft(PDF_MARGIN_SIDE);
  body.setMarginRight(PDF_MARGIN_SIDE);

  // ── Logo ──────────────────────────────────────────────────────────────────
  if (LOGO_FILE_ID) {
    try {
      var logoId = fileIdFromLink(LOGO_FILE_ID) || LOGO_FILE_ID;
      var logoBlob = DriveApp.getFileById(logoId).getBlob();
      body.appendImage(logoBlob).setWidth(PDF_LOGO_WIDTH);
      var logoParagraph = body.getChild(body.getNumChildren() - 1);
      if (logoParagraph.getType() === DocumentApp.ElementType.PARAGRAPH) {
        logoParagraph.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      }
      body.appendParagraph("");
    } catch (logoErr) { Logger.log("Logo not loaded: " + logoErr); }
  }

  // ── Cover ─────────────────────────────────────────────────────────────────
  var titleP = body.appendParagraph("LOAN APPLICATION");
  titleP.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  titleP.setFontSize(14);  // Smaller than logo so logo stays dominant
  titleP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

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
    var links = docLinksArray(dl[key]);
    if (links.length === 0) {
      docField(body, docTypeMap[key], "Not uploaded");
      return;
    }
    var fileId = fileIdFromLink(links[0]);
    var embedded = false;
    if (fileId && links.length === 1) {
      try {
        var docFile = DriveApp.getFileById(fileId);
        var mime    = docFile.getMimeType();
        if (mime && mime.indexOf("image/") === 0) {
          var imgLabel = body.appendParagraph(docTypeMap[key] + ":");
          imgLabel.setFontSize(10);
          imgLabel.editAsText().setBold(0, docTypeMap[key].length, true);
          body.appendImage(docFile.getBlob()).setWidth(PDF_DOC_IMAGE_WIDTH);
          embedded = true;
        }
      } catch (imgErr) { /* fall through to link */ }
    }
    if (!embedded) docField(body, docTypeMap[key], links.join("\n"));
  });

  if (data.folderLink) docField(body, "Drive Folder (all files)", data.folderLink);

  // ── Section 9: Identity Verification ─────────────────────────────────────
  docSection(body, "9. Identity Verification (Selfie)");
  var selfieEmbedded = false;
  if (data.selfieLink && data.selfieLink !== "—") {
    var selfieId = fileIdFromLink(data.selfieLink);
    if (selfieId) {
      try {
        body.appendImage(DriveApp.getFileById(selfieId).getBlob())
          .setWidth(PDF_SELFIE_WIDTH)
          .setHeight(PDF_SELFIE_HEIGHT);
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
  docField(body, "Date", data.submissionDate);
  body.appendParagraph("");
  // Docuseal replaces this tag with an interactive signature field when the PDF is sent for signing
  body.appendParagraph("{{Borrower Signature;role=Borrower;type=signature;format=drawn_or_typed}}");

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
    "Submission Date", "Borrower Name (Signed)", "Signature Image (base64)",
    "Submission ID", "Signature Status"
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

// ── One-time authorization (run once from editor after adding DocumentApp) ───
// Run this function ONCE from the Apps Script editor whenever new Google
// services are added. It will trigger a re-authorization prompt so the
// Web App deployment has the correct OAuth scopes.
function authorizeAll() {
  // Touch every service this script uses so they all appear in the consent screen
  SpreadsheetApp.getActiveSpreadsheet();
  DriveApp.getRootFolder();
  MailApp.getRemainingDailyQuota();
  var tempDoc = DocumentApp.create("_surecap_auth_check");
  DriveApp.getFileById(tempDoc.getId()).setTrashed(true); // clean up immediately
  Logger.log("All services authorized successfully. You can now redeploy the Web App.");
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

/** Normalize docLinks value to array of link strings (supports single link or array). */
function docLinksArray(val) {
  if (Array.isArray(val)) return val.filter(function(v) { return v && String(v).trim(); });
  if (val && typeof val === "string" && val !== "—") return [val];
  return [];
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

/**
 * Normalise a phone number to E.164 format for DocuSeal.
 *
 * International numbers (leading "+" or "00") are preserved as-is after
 * stripping formatting characters — no country code is assumed or forced.
 * Bare 10-digit numbers (or 11-digit numbers starting with "1") are assumed
 * to be NANP and get "+1" prepended.
 *
 * Examples:
 *   "514-555-0123"        → "+15145550123"   (bare NANP 10-digit)
 *   "+1 (514) 555-0123"   → "+15145550123"   (explicit +1)
 *   "0015145550123"       → "+15145550123"   (00-prefixed)
 *   "+254 712 531 490"    → "+254712531490"  (Kenyan, preserved)
 *   "00254712531490"      → "+254712531490"  (00-prefixed international)
 *   ""                    → ""
 */
function formatE164(raw) {
  if (!raw) return "";
  var trimmed = raw.trim();

  // Determine whether the caller supplied an explicit country code.
  var hasCountryCode = trimmed.charAt(0) === "+" || trimmed.indexOf("00") === 0;

  var digits = trimmed.replace(/\D/g, "");

  if (hasCountryCode) {
    // Strip leading 00 (IDD prefix) — replace with "+"
    if (digits.indexOf("00") === 0) digits = digits.substring(2);
    // Need at least 7 digits after country code (shortest valid E.164 is ~7)
    if (digits.length < 7) return "";
    return "+" + digits;
  }

  // No country code supplied — assume NANP (+1)
  // Strip leading 1 if it gives exactly 11 digits
  if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.substring(1);
  if (digits.length < 10) return "";
  return "+1" + digits.slice(-10);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
