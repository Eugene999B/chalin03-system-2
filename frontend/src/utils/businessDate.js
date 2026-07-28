export const BUSINESS_TIME_ZONE = "Africa/Accra";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

function parseBusinessDate(value) {
  if (value === undefined || value === null || value === "") return null;

  const text = String(value).trim();
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  }

  const mysqlTimestampMatch =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/.exec(text);
  const normalized = mysqlTimestampMatch
    ? `${mysqlTimestampMatch[1]}T${mysqlTimestampMatch[2]}Z`
    : text;
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBusinessDate(value) {
  const date = parseBusinessDate(value);
  return date ? dateFormatter.format(date) : "-";
}

export function formatBusinessDateTime(value) {
  const date = parseBusinessDate(value);
  return date ? dateTimeFormatter.format(date) : "-";
}
