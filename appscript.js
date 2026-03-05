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
var LENDER_EMAIL = "your-email@gmail.com"; // the lender / admin who reviews applications
var COMPANY_NAME = "Surecap Finance";
var REPLY_TO     = "no-reply@surecapfinance.com"; // shown as reply-to in emails (cosmetic)
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
