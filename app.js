/* =========================================================================
   Vineet Rawat & Associates — ITR Computation Generator
   Parses e-filing ITR JSON (ITR-1, ITR-2) and renders a firm-letterhead
   computation sheet, matching the CA-office computation format.
   ========================================================================= */

const FIRM = {
  name: "Vineet Rawat & Associates",
  tagline: "Chartered Accountants",
  address: "Office No. 307, Gupta Tower-1, G-Block Commercial Centre, Vikaspuri, New Delhi 110018",
  email: "info.vineetrawat@gmail.com",
  phone: "+91 8287372155",
  partner: "CA Vineet Rawat",
  partnerRole: "Founder & Principal"
};

/* ---------------------------- formatting helpers ---------------------------- */

function inr(x) {
  if (x === null || x === undefined || x === "" || isNaN(x)) return "0";
  let num = Math.round(Number(x));
  const isNegative = num < 0;
  num = Math.abs(num);
  let s = num.toString();
  let lastThree = s.substring(s.length - 3);
  let otherNumbers = s.substring(0, s.length - 3);
  if (otherNumbers !== "") lastThree = "," + lastThree;
  const res = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree;
  return (isNegative ? "(" : "") + res + (isNegative ? ")" : "");
}

function inrOrDash(x) {
  if (x === null || x === undefined) return "";
  return inr(x);
}

function monthName(m) {
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m];
}

function fmtDate(iso) {
  if (!iso) return "";
  const parts = String(iso).split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}-${monthName(parseInt(m, 10) - 1)}-${y}`;
}

function maskAadhaar(a) {
  if (!a) return "";
  const s = String(a).replace(/\D/g, "");
  if (s.length !== 12) return a;
  return `XXXX-XXXX-${s.slice(-4)}`;
}

function ayLabel(ayStart) {
  if (!ayStart) return "";
  const y = parseInt(ayStart, 10);
  return `${y}-${String(y + 1).slice(-2)}`;
}

function yearEndedLabel(ayStart) {
  if (!ayStart) return "";
  const y = parseInt(ayStart, 10);
  return `31-Mar-${y}`;
}

function titleCase(s) {
  if (!s) return "";
  return String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const RETURN_SECTION_MAP = {
  11: "Original — u/s 139(1)",
  12: "Belated — u/s 139(4)",
  13: "Revised — u/s 139(5)",
  14: "In response to notice u/s 142(1)",
  15: "In response to notice u/s 148",
  16: "In response to notice u/s 153A/153C",
  17: "Revised — u/s 139(5)",
  18: "In response to notice u/s 139(9) — Defective",
  19: "Modified return — u/s 92CD",
  20: "In response to notice u/s 119(2)(b)",
  21: "Updated Return — u/s 139(8A)"
};

function filingSectionText(code) {
  return RETURN_SECTION_MAP[code] || `u/s 139 (code ${code})`;
}

const STATUS_MAP = { I: "Individual", H: "HUF", A: "AOP", B: "BOI" };
const RES_STATUS_MAP = { RES: "Resident", NRI: "Non-Resident", RNOR: "Resident but Not Ordinarily Resident" };

function buildAddress(addr) {
  if (!addr) return "";
  let parts;
  if (addr.AddrDetail) {
    parts = [addr.AddrDetail, addr.CityOrTownOrDistrict].filter(Boolean);
  } else {
    parts = [
      addr.ResidenceNo, addr.ResidenceName, addr.RoadOrStreet, addr.LocalityOrArea,
      addr.CityOrTownOrDistrict
    ].filter(Boolean);
  }
  let line = parts.join(", ");
  if (addr.PinCode) line += ` - ${addr.PinCode}`;
  return line;
}

function nonZeroEntries(obj, labelMap) {
  if (!obj) return [];
  return Object.keys(obj)
    .filter((k) => k !== "TotalChapVIADeductions" && typeof obj[k] === "number" && obj[k] !== 0)
    .map((k) => ({ label: (labelMap && labelMap[k]) || k, amount: obj[k] }));
}

const VIA_LABELS = {
  Section80C: "Section 80C",
  Section80CCC: "Section 80CCC",
  Section80CCDEmployeeOrSE: "Section 80CCD(1)",
  Section80CCD1B: "Section 80CCD(1B)",
  Section80CCDEmployer: "Section 80CCD(2) — Employer's contribution to NPS",
  Section80D: "Section 80D",
  Section80DD: "Section 80DD",
  Section80DDB: "Section 80DDB",
  Section80E: "Section 80E",
  Section80EE: "Section 80EE",
  Section80EEA: "Section 80EEA",
  Section80EEB: "Section 80EEB",
  Section80G: "Section 80G",
  Section80GG: "Section 80GG",
  Section80GGA: "Section 80GGA",
  Section80GGC: "Section 80GGC",
  Section80TTA: "Section 80TTA",
  Section80TTB: "Section 80TTB",
  Section80U: "Section 80U",
  AnyOthSec80CCH: "Section 80CCH"
};

const OS_NATURE_LABELS = {
  SAV: "Interest on Savings Bank Account",
  FDR: "Interest on Fixed Deposits",
  DIV: "Dividend Income",
  OTH: null // resolved via OthSrcOthNatOfInc
};

/* ---------------------------------- ITR-1 ---------------------------------- */

function parseITR1(c) {
  const isUpdated = !!c.PartA_139_8A;
  const personal = c.PersonalInfo || {};
  const filing = c.FilingStatus || {};
  const formInfo = c.Form_ITR1 || {};
  const verification = c.Verification || {};
  const incDed = c.ITR1_IncomeDeductions || {};
  const taxComp = c.ITR1_TaxComputation || {};
  const taxPaidBlock = c.TaxPaid || {};
  const refundBlock = c.Refund || {};

  // Salary
  const grossSalary = incDed.GrossSalary ?? incDed.Salary ?? 0;
  const stdDed16ia = incDed.DeductionUs16ia ?? 0;
  const netSalaryIncome = incDed.IncomeFromSal ?? 0;

  // House Property
  let properties = [];
  let hpTotal = 0;
  if (Array.isArray(incDed.PropertyDetails) && incDed.PropertyDetails.length) {
    properties = incDed.PropertyDetails.map((p) => ({
      address: p.AddressDetailWithZipCode ? buildAddress(p.AddressDetailWithZipCode) : "",
      letOut: p.ifLetOut,
      annualValue: p.Rentdetails?.AnnualLetableValue ?? p.Rentdetails?.BalanceALV ?? 0,
      stdDed30: p.Rentdetails?.ThirtyPercentOfBalance ?? 0,
      intOnLoan: p.Rentdetails?.IntOnBorwCap ?? 0,
      incomeOfHP: p.Rentdetails?.IncomeOfHP ?? 0
    }));
    hpTotal = incDed.TotalIncomeChargeableUnHP ?? 0;
  } else if (incDed.GrossRentReceived !== undefined || incDed.TotalIncomeOfHP !== undefined) {
    properties = [{
      address: "",
      letOut: incDed.TypeOfHP,
      annualValue: incDed.AnnualValue ?? incDed.GrossRentReceived ?? 0,
      stdDed30: incDed.StandardDeduction ?? 0,
      intOnLoan: incDed.InterestPayable ?? 0,
      incomeOfHP: incDed.TotalIncomeOfHP ?? 0
    }];
    hpTotal = incDed.TotalIncomeOfHP ?? 0;
  }

  // Other Sources
  const osItems = [];
  const osList = incDed.OthersInc?.OthersIncDtlsOthSrc || [];
  osList.forEach((it) => {
    const amt = it.OthSrcOthAmount ?? 0;
    if (it.OthSrcNatureDesc === "OTH") {
      osItems.push({ label: it.OthSrcOthNatOfInc || "Other Income", amount: amt });
    } else if (it.OthSrcNatureDesc === "DIV") {
      if (amt) osItems.push({ label: "Dividend Income", amount: amt });
    } else if (it.OthSrcNatureDesc === "SAV") {
      osItems.push({ label: "Interest on Savings Bank Account", amount: amt });
    } else if (amt) {
      osItems.push({ label: OS_NATURE_LABELS[it.OthSrcNatureDesc] || it.OthSrcNatureDesc, amount: amt });
    }
  });
  const osTotal = incDed.IncomeOthSrc ?? 0;

  const gti = incDed.GrossTotIncome ?? 0;
  const viaItems = nonZeroEntries(incDed.DeductUndChapVIA, VIA_LABELS);
  const viaTotal = incDed.DeductUndChapVIA?.TotalChapVIADeductions ?? 0;
  const totalIncome = incDed.TotalIncome ?? 0;

  const taxComputation = {
    taxOnTotalIncome: taxComp.TotalTaxPayable ?? 0,
    rebate87A: taxComp.Rebate87A ?? 0,
    taxAfterRebate: taxComp.TaxPayableOnRebate ?? 0,
    surcharge: 0,
    cess: taxComp.EducationCess ?? 0,
    grossTaxLiability: taxComp.GrossTaxLiability ?? 0,
    relief89: taxComp.Section89 ?? 0,
    netTaxLiability: taxComp.NetTaxLiability ?? 0,
    interest: {
      i234A: taxComp.IntrstPay?.IntrstPayUs234A ?? 0,
      i234B: taxComp.IntrstPay?.IntrstPayUs234B ?? 0,
      i234C: taxComp.IntrstPay?.IntrstPayUs234C ?? 0,
      fee234F: taxComp.IntrstPay?.LateFilingFee234F ?? 0
    },
    totalPayable: taxComp.TotTaxPlusIntrstPay ?? 0
  };

  const taxesPaid = {
    tdsSalary: taxPaidBlock.TaxesPaid?.TDS ?? 0,
    tdsOther: 0,
    advanceTax: taxPaidBlock.TaxesPaid?.AdvanceTax ?? 0,
    selfAssessmentTax: taxPaidBlock.TaxesPaid?.SelfAssessmentTax ?? 0,
    tcs: taxPaidBlock.TaxesPaid?.TCS ?? 0,
    total: taxPaidBlock.TaxesPaid?.TotalTaxesPaid ?? 0
  };

  const remarks = [];
  let updatedReturnInfo = null;
  if (isUpdated) {
    const partAti = c["PartB-ATI"] || {};
    const reasonCode = c.PartA_139_8A?.UpdatingInc?.ReasonsForUpdatingIncDtls?.[0]?.ReasonsForUpdatingIncome;
    updatedReturnInfo = {
      previouslyFiled: c.PartA_139_8A?.PreviouslyFiledForThisAY,
      reasonCode,
      updatedTotInc: partAti.UpdatedTotInc,
      taxUS140B: partAti.TaxUS140B,
      feeUS234F: partAti.FeeIncUS234F,
      netPayable: partAti.NetPayable,
      challans: c.ScheduleIT1?.TaxPayment1?.ITTaxPayments || []
    };
    remarks.push(
      `Return filed as an Updated Return u/s 139(8A) of the Income-tax Act, 1961, for Assessment Year ${ayLabel(formInfo.AssessmentYear)}.`
    );
    if (updatedReturnInfo.taxUS140B) {
      remarks.push(`Additional income-tax payable u/s 140B of ₹${inr(updatedReturnInfo.taxUS140B)} has been deposited along with the updated return.`);
    }
  }

  return {
    itrType: "ITR-1",
    itrFormName: formInfo.FormName || "ITR-1",
    isUpdated,
    updatedReturnInfo,
    ayStart: formInfo.AssessmentYear,
    ay: ayLabel(formInfo.AssessmentYear),
    yearEnded: yearEndedLabel(formInfo.AssessmentYear),
    filingSection: filing.ReturnFileSec,
    filingSectionText: filingSectionText(filing.ReturnFileSec),
    dueDate: fmtDate(filing.ItrFilingDueDate),
    name: `${personal.AssesseeName?.FirstName || ""} ${personal.AssesseeName?.SurNameOrOrgName || ""}`.trim(),
    fatherName: verification.Declaration?.FatherName || "",
    pan: personal.PAN || "",
    dob: fmtDate(personal.DOB),
    aadhaar: maskAadhaar(personal.AadhaarCardNo),
    address: buildAddress(personal.Address),
    email: personal.Address?.EmailAddress || "",
    mobile: personal.Address?.MobileNo || "",
    status: "Individual",
    residentialStatus: "Resident",
    natureOfBusiness: null,
    regime: filing.OptOutNewTaxRegime === "Y" ? "Old Tax Regime" : "New Tax Regime [Section 115BAC]",

    salary: {
      present: !!grossSalary,
      gross: grossSalary,
      stdDed16ia,
      net: netSalaryIncome,
      employers: []
    },
    houseProperty: { present: properties.length > 0, properties, total: hpTotal },
    business: { present: false },
    capitalGains: { present: false },
    otherSources: { present: osItems.length > 0, items: osItems, total: osTotal },

    grossTotalIncome: gti,
    chapterVIA: { items: viaItems, total: viaTotal },
    totalIncome,

    taxComputation,
    taxesPaid,
    refundDue: refundBlock.RefundDue ?? 0,
    balanceTaxPayable: taxPaidBlock.BalTaxPayable ?? 0,
    bankAccounts: refundBlock.BankAccountDtls?.AddtnlBankDetails || [],

    tdsDetail: [],
    foreignAssets: [],
    foreignIncome: null,
    remarks,

    signName: verification.Declaration?.AssesseeVerName || "",
    signPlace: verification.Place || "Delhi"
  };
}

/* ---------------------------------- ITR-2 ---------------------------------- */

function parseITR2(c) {
  const personal = c.PartA_GEN1?.PersonalInfo || {};
  const filing = c.PartA_GEN1?.FilingStatus || {};
  const formInfo = c.Form_ITR2 || {};
  const verification = c.Verification || {};
  const schS = c.ScheduleS || {};
  const schOS = c.ScheduleOS?.IncOthThanOwnRaceHorse || {};
  const schVIA = c.ScheduleVIA || {};
  const partTI = c["PartB-TI"] || {};
  const partTTI = c.PartB_TTI || {};
  const schCG = c.ScheduleCGFor23 || null;
  const schFA = c.ScheduleFA || null;
  const schFSI = c.ScheduleFSI || null;
  const schTR = c.ScheduleTR1 || null;
  const schCFL = c.ScheduleCFL || null;

  // Salary
  const employers = (schS.Salaries || []).map((s) => ({
    name: s.NameOfEmployer || "",
    tan: s.TANofEmployer || "",
    address: s.AddressDetail ? buildAddress(s.AddressDetail) : "",
    basic: s.Salarys?.Salary ?? 0,
    perq: s.Salarys?.ValueOfPerquisites ?? 0,
    pls: s.Salarys?.ProfitsinLieuOfSalary ?? 0,
    gross: s.Salarys?.GrossSalary ?? 0
  }));
  const grossSalary = schS.TotalGrossSalary ?? employers.reduce((a, e) => a + e.gross, 0);
  const stdDed16ia = schS.DeductionUnderSection16ia ?? schS.DeductionUS16 ?? 0;
  const netSalaryIncome = schS.TotIncUnderHeadSalaries ?? partTI.Salaries ?? 0;

  // House Property (schema not present in sample — supported generically if it appears)
  const schHP = c.ScheduleHP || null;
  let properties = [];
  let hpTotal = partTI.IncomeFromHP ?? 0;
  if (schHP && Array.isArray(schHP.PropertyDetails)) {
    properties = schHP.PropertyDetails.map((p) => ({
      address: p.AddressDetailWithZipCode ? buildAddress(p.AddressDetailWithZipCode) : "",
      letOut: p.Details?.PropertyType,
      annualValue: p.Details?.AnnualLetableValue ?? 0,
      stdDed30: p.Details?.ThirtyPercentOfBalance ?? 0,
      intOnLoan: p.Details?.IntOnBorwCap ?? 0,
      incomeOfHP: p.Details?.IncomeOfHP ?? 0
    }));
  }

  // Capital Gains
  let capitalGains = { present: false };
  if (schCG) {
    const stcgOtherAssets = schCG.ShortTermCapGainFor23?.SaleOnOtherAssets;
    const items = [];
    if (stcgOtherAssets && (stcgOtherAssets.FullConsideration || stcgOtherAssets.BalanceCG)) {
      items.push({
        label: "Short Term Capital Gain — Sale of Assets (Sec 50CA / Unlisted / Foreign Shares)",
        consideration: stcgOtherAssets.FullConsideration ?? 0,
        cost: stcgOtherAssets.DeductSec48?.TotalDedn ?? 0,
        gain: stcgOtherAssets.BalanceCG ?? 0
      });
    }
    const ltcgEq112A = schCG.LongTermCapGain23?.SaleOfEquityShareUs112A;
    if (ltcgEq112A && ltcgEq112A.BalanceCG) {
      items.push({
        label: "Long Term Capital Gain — Sale of Equity Shares/MF u/s 112A",
        consideration: null,
        cost: null,
        gain: ltcgEq112A.BalanceCG
      });
    }
    const stcgTotal = partTI.CapGain?.ShortTerm?.TotalShortTerm ?? 0;
    const ltcgTotal = partTI.CapGain?.LongTerm?.TotalLongTerm ?? 0;
    const totalCG = partTI.CapGain?.TotalCapGains ?? 0;
    const cflCarried = schCFL?.CurrentAYloss?.LossSummaryDetail || {};
    capitalGains = {
      present: totalCG !== 0 || items.length > 0,
      items,
      stcgTotal,
      ltcgTotal,
      total: totalCG,
      cflNote:
        (cflCarried.TotalSTCGPTILossCF || cflCarried.TotalLTCGPTILossCF)
          ? `Capital loss carried forward to subsequent years — STCL: ₹${inr(cflCarried.TotalSTCGPTILossCF || 0)}, LTCL: ₹${inr(cflCarried.TotalLTCGPTILossCF || 0)} (Schedule CFL).`
          : null
    };
  }

  // Other Sources
  const osItems = [];
  if (schOS.InterestGross) osItems.push({ label: "Interest Income (Savings Bank / FD / Others)", amount: schOS.InterestGross });
  if (schOS.DividendGross) osItems.push({ label: "Dividend Income", amount: schOS.DividendGross });
  if (schOS.RentFromMachPlantBldgs) osItems.push({ label: "Rent from Machinery/Plant/Building", amount: schOS.RentFromMachPlantBldgs });
  if (schOS.FamilyPension) osItems.push({ label: "Family Pension", amount: schOS.FamilyPension });
  if (schOS.OthersGross) osItems.push({ label: "Income from Other Sources — Others", amount: schOS.OthersGross });
  const osGross = (schOS.GrossIncChrgblTaxAtAppRate ?? 0) + (schOS.IncChargeableSpecialRates ?? 0);
  const osDeductions = schOS.Deductions?.TotDeductions ?? 0;
  const osTotal = partTI.IncFromOS?.TotIncFromOS ?? (osGross - osDeductions);

  const gti = partTI.GrossTotalIncome ?? 0;
  const viaItems = nonZeroEntries(schVIA.DeductUndChapVIA, VIA_LABELS);
  const viaTotal = schVIA.DeductUndChapVIA?.TotalChapVIADeductions ?? 0;
  const totalIncome = partTI.TotalIncome ?? 0;

  const ctl = partTTI.ComputationOfTaxLiability || {};
  const taxComputation = {
    taxOnTotalIncome: ctl.TaxPayableOnTI?.TaxPayableOnTotInc ?? 0,
    rebate87A: ctl.Rebate87A ?? 0,
    taxAfterRebate: ctl.TaxPayableOnRebate ?? 0,
    surcharge: ctl.TotalSurcharge ?? 0,
    cess: ctl.EducationCess ?? 0,
    grossTaxLiability: ctl.GrossTaxLiability ?? 0,
    relief89: 0,
    netTaxLiability: ctl.NetTaxLiability ?? 0,
    interest: {
      i234A: ctl.IntrstPay?.IntrstPayUs234A ?? 0,
      i234B: ctl.IntrstPay?.IntrstPayUs234B ?? 0,
      i234C: ctl.IntrstPay?.IntrstPayUs234C ?? 0,
      fee234F: ctl.IntrstPay?.LateFilingFee234F ?? 0
    },
    totalPayable: ctl.AggregateTaxInterestLiability ?? 0
  };

  const tp = partTTI.TaxPaid?.TaxesPaid || {};
  const tdsSalaryDetail = (c.ScheduleTDS1?.TDSonSalary || []).map((t) => ({
    deductor: t.EmployerOrDeductorOrCollectDetl?.EmployerOrDeductorOrCollecterName || "",
    tan: t.EmployerOrDeductorOrCollectDetl?.TAN || "",
    section: "192 — Salary",
    amount: t.TotalTDSSal ?? 0
  }));
  const tdsOtherDetail = (c.ScheduleTDS2?.TDSonOthThanSals || c.ScheduleTDS2?.TDSDtls || []) || [];

  const taxesPaid = {
    tdsSalary: c.ScheduleTDS1?.TotalTDSonSalaries ?? 0,
    tdsOther: (c.ScheduleTDS2?.TotalTDSonOthThanSals ?? 0) + (c.ScheduleTDS3?.TotalTDS3OnOthThanSal ?? 0),
    advanceTax: tp.AdvanceTax ?? 0,
    selfAssessmentTax: tp.SelfAssessmentTax ?? 0,
    tcs: tp.TCS ?? 0,
    total: tp.TotalTaxesPaid ?? 0
  };

  const foreignAssets = (schFA?.DtlsForeignEquityDebtInterest || []).map((f) => ({
    entity: f.NameOfEntity,
    country: f.CountryName,
    date: fmtDate(f.InterestAcquiringDate),
    peakBalance: f.PeakBalanceDuringPeriod,
    closingBalance: f.ClosingBalance
  }));

  let foreignIncome = null;
  if (schFSI && Array.isArray(schFSI.ScheduleFSIDtls) && schFSI.ScheduleFSIDtls.length) {
    const totalReliefClaimed = schTR?.TotalTaxReliefOutsideIndia ?? 0;
    foreignIncome = {
      countries: schFSI.ScheduleFSIDtls.map((f) => f.CountryName),
      totalIncomeFromOutsideIndia: schFSI.ScheduleFSIDtls.reduce((a, f) => a + (f.TotalCountryWise?.IncFrmOutsideInd || 0), 0),
      totalReliefClaimed
    };
  }

  const remarks = [];
  if (capitalGains.cflNote) remarks.push(capitalGains.cflNote);
  if (foreignAssets.length) {
    remarks.push(
      `Foreign asset(s) disclosed under Schedule FA (${foreignAssets.map((f) => f.entity).join(", ")}), being foreign equity/interest held at any time during the relevant calendar year.`
    );
  }
  if (foreignIncome && foreignIncome.countries.length) {
    remarks.push(
      `Income of ₹${inr(foreignIncome.totalIncomeFromOutsideIndia)} arising outside India (${foreignIncome.countries.join(", ")}) has been included in Total Income; relief claimed under Schedule TR is ₹${inr(foreignIncome.totalReliefClaimed)}.`
    );
  }

  return {
    itrType: "ITR-2",
    itrFormName: formInfo.FormName || "ITR-2",
    isUpdated: filing.ReturnFileSec === 21,
    updatedReturnInfo: null,
    ayStart: formInfo.AssessmentYear,
    ay: ayLabel(formInfo.AssessmentYear),
    yearEnded: yearEndedLabel(formInfo.AssessmentYear),
    filingSection: filing.ReturnFileSec,
    filingSectionText: filingSectionText(filing.ReturnFileSec),
    dueDate: fmtDate(filing.ItrFilingDueDate),
    name: `${personal.AssesseeName?.FirstName || ""} ${personal.AssesseeName?.SurNameOrOrgName || ""}`.trim(),
    fatherName: verification.Declaration?.FatherName || "",
    pan: personal.PAN || "",
    dob: fmtDate(personal.DOB),
    aadhaar: maskAadhaar(personal.AadhaarCardNo),
    address: buildAddress(personal.Address),
    email: personal.Address?.EmailAddress || "",
    mobile: personal.Address?.MobileNo || "",
    status: STATUS_MAP[personal.Status] || "Individual",
    residentialStatus: RES_STATUS_MAP[filing.ResidentialStatus] || "Resident",
    natureOfBusiness: null,
    regime: filing.OptOutNewTaxRegime === "Y" ? "Old Tax Regime" : "New Tax Regime [Section 115BAC]",

    salary: { present: !!grossSalary, gross: grossSalary, stdDed16ia, net: netSalaryIncome, employers },
    houseProperty: { present: properties.length > 0, properties, total: hpTotal },
    business: { present: false },
    capitalGains,
    otherSources: { present: osItems.length > 0, items: osItems, total: osTotal },

    grossTotalIncome: gti,
    chapterVIA: { items: viaItems, total: viaTotal },
    totalIncome,

    taxComputation,
    taxesPaid,
    refundDue: partTTI.Refund?.RefundDue ?? 0,
    balanceTaxPayable: partTTI.TaxPaid?.BalTaxPayable ?? 0,
    bankAccounts: partTTI.Refund?.BankAccountDtls?.AddtnlBankDetails || [],

    tdsDetail: [...tdsSalaryDetail, ...tdsOtherDetail],
    foreignAssets,
    foreignIncome,
    remarks,

    signName: verification.Declaration?.AssesseeVerName || "",
    signPlace: verification.Place || "Delhi"
  };
}

/* ------------------------------ dispatcher ------------------------------ */

function detectAndParse(json) {
  const itr = json?.ITR;
  if (!itr) throw new Error("This doesn't look like a valid e-filing ITR JSON (missing 'ITR' root key).");
  if (itr.ITR1) return parseITR1(itr.ITR1);
  if (itr.ITR2) return parseITR2(itr.ITR2);
  if (itr.ITR3) throw new Error("ITR-3 JSON detected. ITR-3 support isn't wired up in this tool yet — ITR-1 and ITR-2 are supported currently.");
  if (itr.ITR4) throw new Error("ITR-4 JSON detected. ITR-4 support isn't wired up in this tool yet — ITR-1 and ITR-2 are supported currently.");
  throw new Error("Could not detect ITR form type in this JSON (expected ITR1 or ITR2 key under 'ITR').");
}

/* ==================================== RENDER ==================================== */

function ed(val, cls) {
  return `<span class="ed ${cls || ""}" contenteditable="true">${val}</span>`;
}

function row(label, value, opts) {
  opts = opts || {};
  const cls = opts.bold ? "row-bold" : "";
  const indent = opts.indent ? "row-indent" : "";
  return `<tr class="${cls} ${indent}">
    <td class="label">${label}</td>
    <td class="amt">${ed(inr(value), "num")}</td>
  </tr>`;
}

function renderInfoGrid(m) {
  const rows = [
    ["Name of Assessee", m.name, "Father's Name", m.fatherName],
    ["Address", m.address, "", ""],
    ["E-Mail", m.email, "Mobile No.", m.mobile],
    ["Status", m.status, "Assessment Year", m.ay],
    ["PAN", m.pan, "Date of Birth", m.dob],
    ["Residential Status", m.residentialStatus, "Year Ended", m.yearEnded],
    ["Aadhaar No.", m.aadhaar, "Filing Status", `${m.itrFormName} — ${m.filingSectionText}`]
  ];
  let html = `<table class="info-grid">`;
  rows.forEach(([l1, v1, l2, v2]) => {
    if (l2 === "" && l1 === "Address") {
      html += `<tr><td class="ik">${l1}</td><td class="iv" colspan="3">${ed(v1, "txt")}</td></tr>`;
    } else {
      html += `<tr><td class="ik">${l1}</td><td class="iv">${ed(v1, "txt")}</td><td class="ik">${l2}</td><td class="iv">${ed(v2, "txt")}</td></tr>`;
    }
  });
  html += `</table>`;
  return html;
}

function renderComputationTable(m) {
  let html = `<div class="sec-head">Computation of Total Income [As per ${m.regime}]</div>`;
  html += `<table class="comp-table"><tbody>`;
  html += `<tr class="grp"><td colspan="2">Income from Salary</td></tr>`;
  if (m.salary.present) {
    html += row("Gross Salary", m.salary.gross, { indent: true });
    html += row("Less: Standard Deduction u/s 16(ia)", -m.salary.stdDed16ia, { indent: true });
    html += row("Income chargeable under the head Salaries", m.salary.net, { bold: true });
  } else {
    html += row("Income chargeable under the head Salaries", 0, { bold: true });
  }

  if (m.business.present) {
    html += `<tr class="grp"><td colspan="2">Income from Business / Profession</td></tr>`;
    html += row("Net Profit / (Loss) from Business", m.business.net, { indent: true });
    html += row("Income chargeable under the head Business/Profession", m.business.chargeable, { bold: true });
  }

  html += `<tr class="grp"><td colspan="2">Income from House Property</td></tr>`;
  if (m.houseProperty.present) {
    m.houseProperty.properties.forEach((p, i) => {
      if (m.houseProperty.properties.length > 1) html += `<tr class="row-indent"><td colspan="2" class="sub-lbl">Property ${i + 1}${p.address ? " — " + p.address : ""}</td></tr>`;
      html += row("Annual Value", p.annualValue, { indent: true });
      html += row("Less: Standard Deduction @ 30%", -p.stdDed30, { indent: true });
      if (p.intOnLoan) html += row("Less: Interest on Borrowed Capital", -p.intOnLoan, { indent: true });
    });
    html += row("Income chargeable under the head House Property", m.houseProperty.total, { bold: true });
  } else {
    html += row("Income chargeable under the head House Property", 0, { bold: true });
  }

  if (m.capitalGains.present) {
    html += `<tr class="grp"><td colspan="2">Income from Capital Gains</td></tr>`;
    if (m.capitalGains.stcgTotal !== undefined) html += row("Short Term Capital Gain (chargeable)", m.capitalGains.stcgTotal, { indent: true });
    if (m.capitalGains.ltcgTotal) html += row("Long Term Capital Gain (chargeable)", m.capitalGains.ltcgTotal, { indent: true });
    html += row("Income chargeable under the head Capital Gains", m.capitalGains.total, { bold: true });
  }

  html += `<tr class="grp"><td colspan="2">Income from Other Sources</td></tr>`;
  if (m.otherSources.present) {
    m.otherSources.items.forEach((it) => {
      html += row(it.label, it.amount, { indent: true });
    });
  }
  html += row("Income chargeable under the head Other Sources", m.otherSources.total, { bold: true });

  html += row("Gross Total Income", m.grossTotalIncome, { bold: true });

  if (m.chapterVIA.items.length) {
    html += `<tr class="grp"><td colspan="2">Less: Deductions under Chapter VI-A</td></tr>`;
    m.chapterVIA.items.forEach((it) => {
      html += row(it.label, -it.amount, { indent: true });
    });
  }

  html += row("Total Income", m.totalIncome, { bold: true });
  html += `</tbody></table>`;
  return html;
}

function renderRemarks(m) {
  if (!m.remarks.length) return "";
  return `<div class="remarks">${m.remarks.map((r) => `<p>${ed(r, "txt")}</p>`).join("")}</div>`;
}

function renderTaxTable(m) {
  const tc = m.taxComputation;
  let html = `<div class="sec-head">Tax Computation</div>`;
  html += `<table class="comp-table"><tbody>`;
  html += row("Tax on Total Income", tc.taxOnTotalIncome);
  html += row("Less: Rebate u/s 87A", -tc.rebate87A);
  html += row("Tax After Rebate", tc.taxAfterRebate);
  if (tc.surcharge) html += row("Add: Surcharge", tc.surcharge);
  html += row("Add: Health & Education Cess @ 4%", tc.cess);
  html += row("Gross Tax Liability", tc.grossTaxLiability, { bold: true });
  if (tc.relief89) html += row("Less: Relief u/s 89", -tc.relief89);
  html += row("Net Tax Liability", tc.netTaxLiability, { bold: true });
  html += `<tr class="grp"><td colspan="2">Interest / Fees</td></tr>`;
  html += row("Interest u/s 234A", tc.interest.i234A, { indent: true });
  html += row("Interest u/s 234B", tc.interest.i234B, { indent: true });
  html += row("Interest u/s 234C", tc.interest.i234C, { indent: true });
  html += row("Late Filing Fee u/s 234F", tc.interest.fee234F, { indent: true });
  html += row("Total Tax + Interest Payable", tc.totalPayable, { bold: true });
  html += `</tbody></table>`;
  return html;
}

function renderTaxesPaidTable(m) {
  const tp = m.taxesPaid;
  let html = `<div class="sec-head">Taxes Paid</div>`;
  html += `<table class="comp-table"><tbody>`;
  html += row("TDS on Salary", tp.tdsSalary);
  html += row("TDS on Income Other than Salary", tp.tdsOther);
  html += row("Advance Tax", tp.advanceTax);
  html += row("Self-Assessment Tax", tp.selfAssessmentTax);
  if (tp.tcs) html += row("TCS", tp.tcs);
  html += row("Total Taxes Paid", tp.total, { bold: true });
  const label = m.refundDue > 0 ? "Refund Due" : "Balance Tax Payable";
  html += row(label, m.refundDue > 0 ? m.refundDue : m.balanceTaxPayable, { bold: true });
  html += `</tbody></table>`;
  return html;
}

function renderScheduleS(m) {
  if (!m.salary.present) return "";
  let html = `<div class="sched-head">Schedule S — Salary Details</div>`;
  html += `<table class="sched-table"><tbody>`;
  if (m.salary.employers.length) {
    m.salary.employers.forEach((e) => {
      html += `<tr class="grp"><td colspan="2">Employer: ${e.name}${e.tan ? " (TAN: " + e.tan + ")" : ""}</td></tr>`;
      html += row("Salary as per Section 17(1)", e.basic, { indent: true });
      if (e.perq) html += row("Value of Perquisites u/s 17(2)", e.perq, { indent: true });
      if (e.pls) html += row("Profits in Lieu of Salary u/s 17(3)", e.pls, { indent: true });
      html += row("Gross Salary", e.gross, { indent: true, bold: true });
    });
  } else {
    html += row("Gross Salary", m.salary.gross);
  }
  html += row("Less: Standard Deduction u/s 16(ia)", -m.salary.stdDed16ia);
  html += row("Income under the head Salaries", m.salary.net, { bold: true });
  html += `</tbody></table>`;
  return html;
}

function renderScheduleHP(m) {
  if (!m.houseProperty.present) return "";
  let html = `<div class="sched-head">Schedule HP — Income from House Property</div>`;
  html += `<table class="sched-table"><tbody>`;
  m.houseProperty.properties.forEach((p, i) => {
    if (m.houseProperty.properties.length > 1) html += `<tr class="grp"><td colspan="2">Property ${i + 1}${p.address ? " — " + p.address : ""}</td></tr>`;
    html += row("Annual Letable / Rent Value", p.annualValue, { indent: true });
    html += row("Less: Standard Deduction @ 30%", -p.stdDed30, { indent: true });
    if (p.intOnLoan) html += row("Less: Interest on Borrowed Capital", -p.intOnLoan, { indent: true });
    html += row("Income from House Property", p.incomeOfHP, { indent: true, bold: true });
  });
  html += `</tbody></table>`;
  return html;
}

function renderScheduleCG(m) {
  if (!m.capitalGains.present) return "";
  let html = `<div class="sched-head">Schedule CG — Capital Gains</div>`;
  html += `<table class="sched-table"><tbody>`;
  (m.capitalGains.items || []).forEach((it) => {
    html += `<tr class="grp"><td colspan="2">${it.label}</td></tr>`;
    if (it.consideration !== null && it.consideration !== undefined) html += row("Full Value of Consideration", it.consideration, { indent: true });
    if (it.cost !== null && it.cost !== undefined) html += row("Less: Cost of Acquisition / Improvement / Expenses", -it.cost, { indent: true });
    html += row("Gain / (Loss)", it.gain, { indent: true, bold: true });
  });
  html += row("Short Term Capital Gain chargeable to tax", m.capitalGains.stcgTotal);
  html += row("Long Term Capital Gain chargeable to tax", m.capitalGains.ltcgTotal);
  html += row("Total Capital Gains chargeable to tax", m.capitalGains.total, { bold: true });
  html += `</tbody></table>`;
  if (m.capitalGains.cflNote) html += `<p class="note">${ed(m.capitalGains.cflNote, "txt")}</p>`;
  return html;
}

function renderScheduleOS(m) {
  if (!m.otherSources.items.length) return "";
  let html = `<div class="sched-head">Schedule OS — Income from Other Sources</div>`;
  html += `<table class="sched-table"><tbody>`;
  m.otherSources.items.forEach((it) => html += row(it.label, it.amount));
  html += row("Income chargeable under the head Other Sources", m.otherSources.total, { bold: true });
  html += `</tbody></table>`;
  return html;
}

function renderScheduleVIA(m) {
  if (!m.chapterVIA.items.length) return "";
  let html = `<div class="sched-head">Schedule VI-A — Deductions</div>`;
  html += `<table class="sched-table"><tbody>`;
  m.chapterVIA.items.forEach((it) => html += row(it.label, it.amount));
  html += row("Total Deduction under Chapter VI-A", m.chapterVIA.total, { bold: true });
  html += `</tbody></table>`;
  return html;
}

function renderScheduleTDS(m) {
  if (!m.tdsDetail.length) return "";
  let html = `<div class="sched-head">Schedule TDS — Tax Deducted at Source</div>`;
  html += `<table class="sched-table detail-table"><thead><tr><th>Deductor</th><th>Section</th><th class="amt">Amount (₹)</th></tr></thead><tbody>`;
  let total = 0;
  m.tdsDetail.forEach((t) => {
    total += t.amount || 0;
    html += `<tr><td>${ed(t.deductor + (t.tan ? " (TAN: " + t.tan + ")" : ""), "txt")}</td><td>${ed(t.section || "", "txt")}</td><td class="amt">${ed(inr(t.amount), "num")}</td></tr>`;
  });
  html += `<tr class="row-bold"><td colspan="2">Total TDS</td><td class="amt">${ed(inr(total), "num")}</td></tr>`;
  html += `</tbody></table>`;
  return html;
}

function renderScheduleFA(m) {
  if (!m.foreignAssets.length) return "";
  let html = `<div class="sched-head">Schedule FA — Foreign Assets (Disclosure)</div>`;
  html += `<table class="sched-table detail-table"><thead><tr><th>Entity</th><th>Country</th><th>Date of Acquisition</th><th class="amt">Closing Balance (₹)</th></tr></thead><tbody>`;
  m.foreignAssets.forEach((f) => {
    html += `<tr><td>${ed(f.entity || "", "txt")}</td><td>${ed(f.country || "", "txt")}</td><td>${ed(f.date || "", "txt")}</td><td class="amt">${ed(inr(f.closingBalance), "num")}</td></tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

function renderUpdatedReturnBlock(m) {
  if (!m.isUpdated || !m.updatedReturnInfo) return "";
  const u = m.updatedReturnInfo;
  let html = `<div class="sched-head">Updated Return Details [u/s 139(8A)]</div>`;
  html += `<table class="sched-table"><tbody>`;
  html += row("Updated Total Income", u.updatedTotInc);
  html += row("Additional Income-tax Payable u/s 140B", u.taxUS140B);
  html += row("Late Filing Fee u/s 234F", u.feeUS234F);
  html += row("Net Amount Payable", u.netPayable, { bold: true });
  html += `</tbody></table>`;
  if (u.challans && u.challans.length) {
    html += `<table class="sched-table detail-table"><thead><tr><th>BSR Code</th><th>Date of Deposit</th><th>Challan No.</th><th class="amt">Amount (₹)</th></tr></thead><tbody>`;
    u.challans.forEach((c) => {
      html += `<tr><td>${c.BSRCode || ""}</td><td>${fmtDate(c.DateDep)}</td><td>${c.SrlNoOfChaln || ""}</td><td class="amt">${inr(c.Amt)}</td></tr>`;
    });
    html += `</tbody></table>`;
  }
  return html;
}

function renderSignature(m) {
  return `<div class="sign-block">
    <p class="disclaimer">This computation has been prepared on the basis of information and documents furnished by the assessee and the pre-filled/ITR JSON data, for the purpose of e-filing the Return of Income for AY ${m.ay}. It is subject to verification of supporting documents and any subsequent rectification/intimation under the Income-tax Act, 1961.</p>
    <p class="sign-for">For ${FIRM.name}</p>
    <p class="sign-space">&nbsp;</p>
    <p class="sign-name">${FIRM.partner}</p>
    <p class="sign-role">${FIRM.partnerRole}</p>
  </div>`;
}

function renderLetterhead() {
  return `<div class="letterhead">
    <div class="firm-name">${FIRM.name} — Chartered Accountants</div>
    <div class="firm-line">${FIRM.address}</div>
    <div class="firm-line">${FIRM.email} | ${FIRM.phone}</div>
  </div>
  <div class="doc-title">ITR Computation</div>`;
}

function renderComputation(m) {
  return `
    ${renderLetterhead()}
    ${renderInfoGrid(m)}
    ${renderComputationTable(m)}
    ${renderRemarks(m)}
    ${renderTaxTable(m)}
    ${renderTaxesPaidTable(m)}
    <div class="schedules">
      ${renderScheduleS(m)}
      ${renderScheduleHP(m)}
      ${renderScheduleCG(m)}
      ${renderScheduleOS(m)}
      ${renderScheduleVIA(m)}
      ${renderScheduleTDS(m)}
      ${renderScheduleFA(m)}
      ${renderUpdatedReturnBlock(m)}
    </div>
    ${renderSignature(m)}
  `;
}
