/**
 * Surecap Finance — Google Apps Script Web App Backend
 *
 * Paste this entire file into: Google Sheet → Extensions → Apps Script
 * Deploy as a Web App → use the URL as APPS_SCRIPT_URL in index.html
 *
 * What this does on each submission:
 *   1. Appends every field as a row in the active Google Sheet
 *   2. Emails the lender (LENDER_EMAIL) a formatted credit summary
 *   3. Emails the applicant a confirmation receipt
 */

// ─────────────────────────────────────────
// CONFIGURE THESE BEFORE DEPLOYING
// ─────────────────────────────────────────
var LENDER_EMAIL = "isafariapp@gmail.com"; // the lender / admin who reviews applications
var COMPANY_NAME = "Surecap Finance";
var REPLY_TO     = "isafariapp@gmail.com"; // shown as reply-to in emails (cosmetic)
// ─────────────────────────────────────────

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data  = JSON.parse(e.postData.contents);

    // 1. Write to Google Sheet
    var row = [
      new Date().toLocaleString(),
      data.name, data.address, data.cellPhone, data.otherPhone, data.email,
      data.employerName, data.employerAddress, data.yearsEmployed,
      data.employmentType, data.compensationType, data.employerPhone, data.employerEmail,
      data.income1Source, data.income1Amount,
      data.income2Source, data.income2Amount,
      data.income3Source, data.income3Amount,
      data.investmentIncome, data.totalGrossIncome,
      data.housing, data.propertyTaxes, data.condoFees, data.insurance,
      data.heating, data.alimony, data.childSupport, data.otherObligations,
      data.totalMonthlyObligations,
      data.creditCards, data.personalLoan, data.autoLoan, data.studentLoan,
      data.surecapLoanInterest, data.totalDebtExpenses, data.dti,
      data.stocksInvestments, data.prop1Value, data.prop2Value, data.prop3Value,
      data.otherAssets, data.totalAssets,
      data.ccDebt, data.lineOfCredit, data.personalLoansLiab,
      data.mortgage1, data.mortgage2, data.mortgage3, data.totalDebt, data.netWorth,
      data.prop1Address, data.prop1MarketValue, data.prop1Mortgage, data.prop1Equity, data.prop1LTV,
      data.prop2Address, data.prop2MarketValue, data.prop2Mortgage, data.prop2Equity, data.prop2LTV,
      data.prop3Address, data.prop3MarketValue, data.prop3Mortgage, data.prop3Equity, data.prop3LTV,
      data.documentsProvided,
      data.submissionDate, data.borrowerNameSigned,
      // signatureImage is a large base64 string — stored in sheet but omitted from emails
      data.signatureImage
    ];
    sheet.appendRow(row);

    // 2. Email the lender — credit risk summary
    var dtiNum   = parseFloat(data.dti)   || 0;
    var dtiFlag  = dtiNum > 43 ? "⚠️ HIGH DTI" : dtiNum > 36 ? "⚠️ ELEVATED DTI" : "✅ ACCEPTABLE DTI";
    var nwNum    = parseFloat(data.netWorth) || 0;
    var nwFlag   = nwNum < 0 ? "⚠️ NEGATIVE NET WORTH" : "✅ POSITIVE NET WORTH";

    var lenderSubject = "[" + COMPANY_NAME + "] New application from " + data.name;

    var lenderBody = [
      "A new loan application was received on " + new Date().toLocaleString(),
      "",
      "═══════════════════════════════════════",
      "  APPLICANT OVERVIEW",
      "═══════════════════════════════════════",
      "Name            : " + data.name,
      "Email           : " + data.email,
      "Cell            : " + data.cellPhone,
      "Address         : " + data.address,
      "",
      "Employer        : " + data.employerName,
      "Employment Type : " + data.employmentType,
      "Compensation    : " + data.compensationType,
      "Years Employed  : " + data.yearsEmployed,
      "",
      "═══════════════════════════════════════",
      "  CREDIT RISK METRICS",
      "═══════════════════════════════════════",
      "Total Gross Monthly Income  : $" + fmt(data.totalGrossIncome),
      "Total Monthly Obligations   : $" + fmt(data.totalMonthlyObligations),
      "Total Debt Expenses         : $" + fmt(data.totalDebtExpenses),
      "Debt-to-Income (DTI)        : " + data.dti + "%   " + dtiFlag,
      "",
      "Total Assets                : $" + fmt(data.totalAssets),
      "Total Debt                  : $" + fmt(data.totalDebt),
      "Net Worth                   : $" + fmt(data.netWorth) + "   " + nwFlag,
      "",
      "═══════════════════════════════════════",
      "  INCOME BREAKDOWN",
      "═══════════════════════════════════════",
      incomeRow(data.income1Source, data.income1Amount),
      incomeRow(data.income2Source, data.income2Amount),
      incomeRow(data.income3Source, data.income3Amount),
      incomeRow("Investments / other", data.investmentIncome),
      "",
      "═══════════════════════════════════════",
      "  PROPERTIES",
      "═══════════════════════════════════════",
      propRow(1, data.prop1Address, data.prop1MarketValue, data.prop1Mortgage, data.prop1Equity, data.prop1LTV),
      propRow(2, data.prop2Address, data.prop2MarketValue, data.prop2Mortgage, data.prop2Equity, data.prop2LTV),
      propRow(3, data.prop3Address, data.prop3MarketValue, data.prop3Mortgage, data.prop3Equity, data.prop3LTV),
      "",
      "═══════════════════════════════════════",
      "  DOCUMENTS CHECKLIST",
      "═══════════════════════════════════════",
      data.documentsProvided || "None indicated",
      "",
      "Submission Date : " + data.submissionDate,
      "Signed By       : " + data.borrowerNameSigned,
      "",
      "─────────────────────────────────────────",
      "Full data is in your Google Sheet.",
      "─────────────────────────────────────────"
    ].join("\n");

    MailApp.sendEmail({
      to:      LENDER_EMAIL,
      subject: lenderSubject,
      body:    lenderBody,
      replyTo: data.email  // reply goes straight to the applicant
    });

    // 3. Email the applicant — confirmation receipt
    if (data.email) {
      var applicantSubject = "Your " + COMPANY_NAME + " application has been received";
      var applicantBody = [
        "Dear " + data.name + ",",
        "",
        "Thank you for submitting your loan application to " + COMPANY_NAME + ".",
        "",
        "We have received your application and our team will review your information",
        "and contact you shortly at " + data.email + " or " + data.cellPhone + ".",
        "",
        "Here is a summary of what you submitted:",
        "",
        "  Submission date          : " + data.submissionDate,
        "  Total gross monthly income: $" + fmt(data.totalGrossIncome),
        "  Debt-to-income ratio      : " + data.dti + "%",
        "  Net worth                 : $" + fmt(data.netWorth),
        "",
        "If you have any questions, please contact us.",
        "",
        "Sincerely,",
        COMPANY_NAME + " Team"
      ].join("\n");

      MailApp.sendEmail({
        to:      data.email,
        subject: applicantSubject,
        body:    applicantBody,
        replyTo: LENDER_EMAIL
      });
    }

    return ContentService
      .createTextOutput(JSON.stringify({ result: "success" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─────────────────────────────────────────
// One-time setup — run this ONCE from the Apps Script
// editor (Run → setupHeaders) to add column headers,
// freeze row 1, and bold the header row.
// Safe to re-run: it always overwrites row 1.
// ─────────────────────────────────────────
function setupHeaders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  var headers = [
    "Timestamp",
    // Section 1 — Borrower Information
    "Full Name", "Address", "Cell Phone", "Other Phone", "Email",
    "Employer Name", "Employer Address", "Years with Employer",
    "Employment Type", "Compensation Type", "Employer Phone", "Employer Email",
    // Section 2 — Income
    "Income 1 Source", "Income 1 Amount ($)",
    "Income 2 Source", "Income 2 Amount ($)",
    "Income 3 Source", "Income 3 Amount ($)",
    "Investment Income ($)", "Total Gross Monthly Income ($)",
    // Section 3 — Monthly Obligations
    "Housing ($)", "Property Taxes ($)", "Condo Fees ($)", "Insurance ($)",
    "Heating ($)", "Alimony ($)", "Child Support / Alimony ($)", "Other Obligations ($)",
    "Total Monthly Obligations ($)",
    // Section 4 — Debt Payments
    "Credit Cards Min Payment ($)", "Personal Loan ($)", "Auto Loan ($)",
    "Student Loan ($)", "SureCap Loan Interest ($)",
    "Total Debt Expenses ($)", "DTI (%)",
    // Section 5 — Assets
    "Stocks & Investments ($)", "Property 1 Value ($)", "Property 2 Value ($)", "Property 3 Value ($)",
    "Other Assets ($)", "Total Assets ($)",
    // Section 6 — Liabilities
    "Credit Card Debt ($)", "Line of Credit ($)", "Personal Loans ($)",
    "Mortgage Property 1 ($)", "Mortgage Property 2 ($)", "Mortgage Property 3 ($)",
    "Total Debt ($)", "Net Worth ($)",
    // Section 7 — Property Details
    "Property 1 Address", "Prop 1 Market Value ($)", "Prop 1 Mortgage ($)", "Prop 1 Equity ($)", "Prop 1 LTV (%)",
    "Property 2 Address", "Prop 2 Market Value ($)", "Prop 2 Mortgage ($)", "Prop 2 Equity ($)", "Prop 2 LTV (%)",
    "Property 3 Address", "Prop 3 Market Value ($)", "Prop 3 Mortgage ($)", "Prop 3 Equity ($)", "Prop 3 LTV (%)",
    // Section 8 — Documents & Signature
    "Documents Provided",
    "Submission Date", "Borrower Name (Signed)", "Signature Image (base64)"
  ];

  // Write headers to row 1
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Bold and freeze row 1
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  sheet.setFrozenRows(1);

  // Set background colour on header row
  sheet.getRange(1, 1, 1, headers.length).setBackground("#1B2A4A");
  sheet.getRange(1, 1, 1, headers.length).setFontColor("#FFFFFF");

  // Narrow the signature column (last column) — base64 is huge
  var sigColIndex = headers.length;
  sheet.setColumnWidth(sigColIndex, 120);

  // Auto-resize all other columns to fit content
  for (var i = 1; i < sigColIndex; i++) {
    sheet.autoResizeColumn(i);
  }

  Logger.log("Headers set. Total columns: " + headers.length);
}

// ─────────────────────────────────────────
// Manual test — run this from the Apps Script
// editor (Run → testDoPost) to test without
// the form. Check View → Logs for output.
// ─────────────────────────────────────────
function testDoPost() {
  var fakeData = {
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
    heating: 80, alimony: 0, childSupport: 0, otherObligations: 0,
    totalMonthlyObligations: 1580,
    creditCards: 150, personalLoan: 0, autoLoan: 400, studentLoan: 200,
    surecapLoanInterest: 0, totalDebtExpenses: 750, dti: "44.8",
    stocksInvestments: 10000, prop1Value: 350000, prop2Value: 0, prop3Value: 0,
    otherAssets: 5000, totalAssets: 365000,
    ccDebt: 3000, lineOfCredit: 5000, personalLoansLiab: 0,
    mortgage1: 280000, mortgage2: 0, mortgage3: 0,
    totalDebt: 288000, netWorth: 77000,
    prop1Address: "123 Test St, Montreal, QC", prop1MarketValue: 350000,
    prop1Mortgage: 280000, prop1Equity: 70000, prop1LTV: "80.0",
    prop2Address: "", prop2MarketValue: 0, prop2Mortgage: 0, prop2Equity: 0, prop2LTV: "",
    prop3Address: "", prop3MarketValue: 0, prop3Mortgage: 0, prop3Equity: 0, prop3LTV: "",
    documentsProvided: "Pay stubs / proof of income, Credit report",
    submissionDate: "2026-03-03", borrowerNameSigned: "Test User",
    signatureImage: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  };

  var fakeEvent = {
    postData: { contents: JSON.stringify(fakeData) }
  };

  var result = doPost(fakeEvent);
  Logger.log("Result: " + result.getContent());
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

function fmt(value) {
  var num = parseFloat(value) || 0;
  return num.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function incomeRow(source, amount) {
  if (!source && !parseFloat(amount)) return "";
  return "  " + (source || "—") + ": $" + fmt(amount);
}

function propRow(num, address, market, mortgage, equity, ltv) {
  if (!address && !parseFloat(market)) return "  Property " + num + ": —";
  return [
    "  Property " + num + ": " + (address || "—"),
    "    Market Value : $" + fmt(market),
    "    Mortgage     : $" + fmt(mortgage),
    "    Equity       : $" + fmt(equity),
    "    LTV          : " + (ltv || "—") + "%"
  ].join("\n");
}
