// Classification d'une arrivée sur le site : canal, plateforme et identifiants
// de campagne. Pur (aucun import d'exécution) : utilisé par la collecte,
// l'interface et les tests (node --experimental-strip-types).

export type Channel =
  | "paid_meta"
  | "paid_google"
  | "paid_tiktok"
  | "paid_linkedin"
  | "paid_other"
  | "organic_search"
  | "organic_social"
  | "email"
  | "referral"
  | "short_link"
  | "direct"
  | "none";

export const CHANNELS: Record<Channel, { name: string; slot: number; paid?: boolean }> = {
  paid_meta: { name: "Meta Ads", slot: 1, paid: true },
  paid_google: { name: "Google Ads", slot: 2, paid: true },
  paid_tiktok: { name: "TikTok Ads", slot: 3, paid: true },
  paid_linkedin: { name: "LinkedIn Ads", slot: 4, paid: true },
  paid_other: { name: "Autres régies", slot: 5, paid: true },
  organic_search: { name: "Recherche organique", slot: 6 },
  organic_social: { name: "Réseaux sociaux (organique)", slot: 7 },
  email: { name: "Email", slot: 8 },
  referral: { name: "Sites référents", slot: 3 },
  short_link: { name: "Liens courts", slot: 4 },
  direct: { name: "Direct", slot: 0 },
  none: { name: "Sans point de contact", slot: 0 },
};

export const channelName = (c: string) => CHANNELS[c as Channel]?.name ?? c;
export const channelColor = (c: string) => {
  const s = CHANNELS[c as Channel]?.slot ?? 5;
  return s === 0 ? "var(--viz-prev)" : `var(--viz-${s})`;
};
export const isPaid = (c: string) => !!CHANNELS[c as Channel]?.paid;

/** Régie publicitaire (ad_accounts.platform) → canal payant. */
export function platformChannel(platform: string): Channel {
  switch (platform) {
    case "meta":
      return "paid_meta";
    case "google":
      return "paid_google";
    case "tiktok":
      return "paid_tiktok";
    case "linkedin":
      return "paid_linkedin";
    default:
      return "paid_other";
  }
}

export const CLICK_IDS = ["gclid", "gbraid", "wbraid", "fbclid", "ttclid", "msclkid", "li_fat_id", "sccid", "epik", "twclid", "rdt_cid"] as const;

const PAID_MEDIUM = /^(cpc|ppc|cpm|cpv|cpa|paid|paid[-_ ]?(search|social|media|ads?)?|ads?|display|banner|retargeting|remarketing|sponsored|social[-_ ]?paid|psocial|paidsocial|pmax|shopping|video[-_]?ads?)$/;
const EMAIL_MEDIUM = /^(e-?mail|newsletter|mailing|emailing|crm|sms)$/;
const SOCIAL_MEDIUM = /^(social|social[-_ ]?(network|media|organic)|organic[-_ ]?social|sm|bio|story|stories|post|reel|community)$/;

const SEARCH_HOSTS: [RegExp, string][] = [
  [/(^|\.)google\./, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)search\.yahoo\.|(^|\.)yahoo\.com$/, "yahoo"],
  [/(^|\.)qwant\.com$/, "qwant"],
  [/(^|\.)ecosia\.org$/, "ecosia"],
  [/(^|\.)yandex\./, "yandex"],
  [/(^|\.)baidu\.com$/, "baidu"],
  [/(^|\.)search\.brave\.com$/, "brave"],
  [/(^|\.)startpage\.com$/, "startpage"],
  [/(^|\.)lilo\.org$/, "lilo"],
];
const SOCIAL_HOSTS: [RegExp, string][] = [
  [/(^|\.)(facebook\.com|fb\.me|fb\.com|messenger\.com)$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "x"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(pinterest\.[a-z.]+|pin\.it)$/, "pinterest"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)snapchat\.com$/, "snapchat"],
  [/(^|\.)threads\.(net|com)$/, "threads"],
  [/(^|\.)whatsapp\.com$/, "whatsapp"],
  [/(^|\.)bsky\.app$/, "bluesky"],
];
const MAIL_HOSTS = /(^|\.)(mail\.google\.com|outlook\.(live|office|office365)\.com|mail\.yahoo\.com|webmail\.|mail\.orange\.fr|mail\.free\.fr|zimbra\.free\.fr|mail\.sfr\.fr|laposte\.net|mail\.proton\.me|icloud\.com)/;

const SOURCE_PLATFORM: [RegExp, string][] = [
  [/^(facebook|fb|instagram|ig|meta|messenger|audience[-_ ]?network|an)$/, "meta"],
  [/^(google|adwords|google[-_ ]?ads|youtube|yt|gdn|dv360)$/, "google"],
  [/^(tiktok|tt)$/, "tiktok"],
  [/^(linkedin|li)$/, "linkedin"],
  [/^(bing|microsoft|msn)$/, "microsoft"],
  [/^(snapchat|snap)$/, "snapchat"],
  [/^(pinterest)$/, "pinterest"],
  [/^(twitter|x)$/, "x"],
  [/^(chatgpt|openai)$/, "chatgpt"],
];

function sourcePlatform(source: string) {
  for (const [re, p] of SOURCE_PLATFORM) if (re.test(source)) return p;
  return null;
}

function paidChannel(platform: string | null): Channel {
  if (platform === "meta") return "paid_meta";
  if (platform === "google") return "paid_google";
  if (platform === "tiktok") return "paid_tiktok";
  if (platform === "linkedin") return "paid_linkedin";
  return "paid_other";
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Le domaine `host` appartient-il à l'un des domaines déclarés (sous-domaines compris) ? */
export function hostMatches(host: string, domains: string[]) {
  const h = host.toLowerCase().replace(/^www\./, "");
  return domains.some((d) => {
    const x = d.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").replace(/^\*\./, "");
    return !!x && (h === x || h.endsWith("." + x));
  });
}

export interface Arrival {
  channel: Channel;
  platform: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  utm_id: string | null;
  click_id_type: string | null;
  click_id: string | null;
  campaign_key: string | null;
  adset_key: string | null;
  ad_key: string | null;
  link_token: string | null;
  /** true si l'URL ou le référent portent une source (sinon : nouvelle session directe) */
  sourced: boolean;
}

const clip = (v: string | null | undefined, n = 200) => (v ? v.trim().slice(0, n) || null : null);

/**
 * Canal d'une arrivée : UTM d'abord, puis identifiants de clic, puis référent externe.
 * `ownDomains` : domaines du site (un référent interne n'est pas une source).
 * `shortLink` : l'arrivée vient d'un lien court (aos_lid résolu).
 */
export function classify(landingUrl: string, referrer: string, ownDomains: string[] = [], shortLink = false): Arrival {
  let q = new URLSearchParams();
  let landingHost = "";
  try {
    const u = new URL(landingUrl);
    q = u.searchParams;
    landingHost = u.hostname.toLowerCase();
  } catch {
    /* URL invalide : aucune source */
  }
  const get = (k: string) => clip(q.get(k));
  const out: Arrival = {
    channel: "direct",
    platform: null,
    utm_source: get("utm_source"),
    utm_medium: get("utm_medium"),
    utm_campaign: get("utm_campaign"),
    utm_content: get("utm_content"),
    utm_term: get("utm_term"),
    utm_id: get("utm_id"),
    click_id_type: null,
    click_id: null,
    campaign_key: null,
    adset_key: clip(q.get("aos_adset"), 64),
    ad_key: clip(q.get("aos_ad"), 64),
    link_token: clip(q.get("aos_lid"), 64),
    sourced: false,
  };
  for (const k of CLICK_IDS) {
    const v = q.get(k);
    if (v) {
      out.click_id_type = k;
      out.click_id = v.slice(0, 255);
      break;
    }
  }
  // Clé de campagne : utm_id, sinon utm_campaign numérique (ValueTrack {campaignid})
  out.campaign_key = clip(out.utm_id, 64) ?? (out.utm_campaign && /^\d{5,}$/.test(out.utm_campaign) ? out.utm_campaign : null);

  const refHost = hostOf(referrer);
  const external = !!refHost && refHost !== landingHost.replace(/^www\./, "") && !hostMatches(refHost, ownDomains);
  const src = (out.utm_source ?? "").toLowerCase();
  const med = (out.utm_medium ?? "").toLowerCase();
  const hasUtm = !!(out.utm_source || out.utm_medium || out.utm_campaign);
  out.sourced = hasUtm || !!out.click_id || !!out.link_token || external;

  // 1. UTM
  if (hasUtm) {
    const pf = sourcePlatform(src);
    out.platform = pf ?? (src || null);
    if (PAID_MEDIUM.test(med) || ((out.utm_id || out.ad_key) && pf && !EMAIL_MEDIUM.test(med) && !SOCIAL_MEDIUM.test(med)) || (out.click_id && out.click_id_type !== "fbclid")) {
      out.channel = paidChannel(pf ?? clickPlatform(out.click_id_type));
      if (!out.platform && out.click_id_type) out.platform = clickPlatform(out.click_id_type);
    } else if (EMAIL_MEDIUM.test(med) || src === "newsletter" || src === "email") out.channel = "email";
    else if (med === "organic" || SEARCH_HOSTS.some(([re]) => re.test(src + "."))) out.channel = "organic_search";
    else if (SOCIAL_MEDIUM.test(med) || (pf && ["meta", "tiktok", "linkedin", "snapchat", "pinterest", "x"].includes(pf))) out.channel = "organic_social";
    else if (shortLink) out.channel = "short_link";
    else out.channel = "referral";
    return out;
  }
  // 2. Identifiants de clic seuls
  if (out.click_id_type) {
    const pf = clickPlatform(out.click_id_type);
    out.platform = pf;
    // fbclid est ajouté à tous les liens sortants de Facebook/Instagram, pubs ET publications :
    // sans UTM, on ne peut pas le compter comme payant.
    out.channel = out.click_id_type === "fbclid" ? "organic_social" : paidChannel(pf);
    return out;
  }
  // 3. Lien court sans UTM
  if (shortLink || out.link_token) {
    out.channel = "short_link";
    return out;
  }
  // 4. Référent externe
  if (external) {
    if (MAIL_HOSTS.test(refHost)) {
      out.channel = "email";
      return out;
    }
    for (const [re, p] of SEARCH_HOSTS)
      if (re.test(refHost)) {
        out.channel = "organic_search";
        out.platform = p;
        return out;
      }
    for (const [re, p] of SOCIAL_HOSTS)
      if (re.test(refHost)) {
        out.channel = "organic_social";
        out.platform = p;
        return out;
      }
    out.channel = "referral";
    out.platform = refHost.slice(0, 60);
  }
  return out;
}

function clickPlatform(t: string | null): string | null {
  switch (t) {
    case "gclid":
    case "gbraid":
    case "wbraid":
      return "google";
    case "fbclid":
      return "meta";
    case "ttclid":
      return "tiktok";
    case "li_fat_id":
      return "linkedin";
    case "msclkid":
      return "microsoft";
    case "sccid":
      return "snapchat";
    case "epik":
      return "pinterest";
    case "twclid":
      return "x";
    case "rdt_cid":
      return "reddit";
    default:
      return null;
  }
}

/** Type d'appareil approximatif depuis le user-agent. */
export function deviceOf(ua: string) {
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return "mobile";
  return "desktop";
}

export const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|pingdom|uptime|monitor|preview|facebookexternalhit|embedly|quora link|whatsapp|telegram|discord|curl|wget|python-requests|axios|node-fetch|go-http|java\/|phantom|puppeteer|playwright|selenium|scrapy|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|perplexity/i;
