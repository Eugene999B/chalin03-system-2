const LETTER_TYPES = Object.freeze({
  employment: { title: "Employment / Appointment Letter", prefix: "EMP", acknowledgement: "accepted" },
  probation_confirmation: { title: "Confirmation of Employment", prefix: "CNF", acknowledgement: "received" },
  probation_extension: { title: "Probation Extension Letter", prefix: "PBE", acknowledgement: "received" },
  show_cause: { title: "Notice to Explain / Show Cause", prefix: "NTE", acknowledgement: "received" },
  warning: { title: "Written Warning Letter", prefix: "WRN", acknowledgement: "received" },
  final_warning: { title: "Final Written Warning Letter", prefix: "FWR", acknowledgement: "received" },
  suspension: { title: "Suspension Letter", prefix: "SUS", acknowledgement: "received" },
  termination: { title: "Termination of Employment Letter", prefix: "TRM", acknowledgement: "received" },
  promotion_transfer: { title: "Promotion / Transfer Letter", prefix: "PTR", acknowledgement: "accepted" },
  resignation_acceptance: { title: "Resignation Acceptance and Clearance Letter", prefix: "RSG", acknowledgement: "received" },
});

const DEFAULT_WORKPLACE_RULES = Object.freeze([
  "Report to work punctually and follow the approved attendance, shift and leave procedures.",
  "Perform assigned duties carefully and obey lawful and reasonable instructions from authorised supervisors.",
  "Follow all health, safety, environmental and personal protective equipment requirements.",
  "Protect company money, stock, fuel, tools, machinery, vehicles, documents, passwords and other property.",
  "Record sales, stock, fuel, production, equipment hours, payments and other business information honestly and accurately.",
  "Do not steal, defraud, falsify records, divert company resources or make unauthorised transactions.",
  "Do not report to work under the influence of alcohol or illegal drugs and do not possess them at the workplace.",
  "Treat customers, colleagues, contractors and supervisors respectfully; harassment, discrimination, threats and violence are prohibited.",
  "Keep confidential company, customer, worker, pricing, financial and operational information secure.",
  "Use only your own authorised system account and never share passwords, access codes or identity cards.",
  "Report accidents, safety hazards, losses, damage, misconduct and suspected fraud promptly.",
  "Do not accept bribes, secret commissions or undisclosed personal benefits connected with company work.",
  "Avoid conflicts of interest and disclose any outside activity that may affect company duties.",
  "Obtain approval before being absent, leaving the assigned work location or using company property for private purposes.",
  "Return all company property, records, keys, identity cards and equipment when requested or when employment ends.",
  "Comply with the procedures of the assigned Spare Parts store, Mining site or Equipment Hire location.",
]);

function workspaceLabel(code) {
  if (code === "mining") return "Mining Operations";
  if (code === "equipment_hire") return "Equipment Hire";
  return "Spare Parts";
}

function workspacePrefix(code) {
  if (code === "mining") return "MIN";
  if (code === "equipment_hire") return "HIRE";
  return "SP";
}

module.exports = {
  LETTER_TYPES,
  DEFAULT_WORKPLACE_RULES,
  workspaceLabel,
  workspacePrefix,
};
