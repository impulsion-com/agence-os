// Invitation iCalendar (.ics) : jointe à l'email de confirmation quand Google Agenda
// n'est pas connecté, et téléchargeable depuis la page de confirmation.

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d: string | number | Date) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Replie les lignes à 75 octets (RFC 5545) */
function fold(line: string) {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 73) {
      out.push(cur);
      cur = " " + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}

export function buildIcs(o: {
  uid: string;
  title: string;
  description: string;
  start: string;
  end: string;
  location?: string;
  url?: string;
  organizer?: { name: string; email: string };
  attendee?: { name: string; email: string };
  cancelled?: boolean;
  sequence?: number;
}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Agence OS//Rendez-vous//FR",
    "CALSCALE:GREGORIAN",
    `METHOD:${o.cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${o.uid}@agence-os`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(o.start)}`,
    `DTEND:${stamp(o.end)}`,
    `SEQUENCE:${o.sequence ?? 0}`,
    `SUMMARY:${esc(o.title)}`,
    `DESCRIPTION:${esc(o.description)}`,
    o.location ? `LOCATION:${esc(o.location)}` : "",
    o.url ? `URL:${o.url}` : "",
    o.organizer?.email ? `ORGANIZER;CN=${esc(o.organizer.name)}:mailto:${o.organizer.email}` : "",
    o.attendee?.email ? `ATTENDEE;CN=${esc(o.attendee.name)};ROLE=REQ-PARTICIPANT:mailto:${o.attendee.email}` : "",
    `STATUS:${o.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Rappel",
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.map(fold).join("\r\n") + "\r\n";
}
