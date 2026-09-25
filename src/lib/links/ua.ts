// Analyse légère du user-agent pour les clics sur liens courts (aucune dépendance).

// Robots d'aperçu de lien et d'indexation : comptés à part, exclus des statistiques.
const BOTS: [RegExp, string][] = [
  [/facebookexternalhit|facebookcatalog|meta-externalagent|facebot/i, "Aperçu Facebook"],
  [/whatsapp/i, "Aperçu WhatsApp"],
  [/slackbot|slack-imgproxy/i, "Aperçu Slack"],
  [/twitterbot/i, "Aperçu X (Twitter)"],
  [/linkedinbot/i, "Aperçu LinkedIn"],
  [/telegrambot/i, "Aperçu Telegram"],
  [/discordbot/i, "Aperçu Discord"],
  [/skypeuripreview/i, "Aperçu Teams / Skype"],
  [/pinterestbot|pinterest\/0\./i, "Aperçu Pinterest"],
  [/snapchat.*preview|snapchat\/\d+.*bot/i, "Aperçu Snapchat"],
  [/applebot/i, "Applebot"],
  [/googlebot|google-inspectiontool|googleother|adsbot-google|mediapartners-google|google-read-aloud|feedfetcher-google/i, "Googlebot"],
  [/bingbot|bingpreview|msnbot/i, "Bingbot"],
  [/yandex|baiduspider|duckduckbot|petalbot|seznambot/i, "Moteur de recherche"],
  [/gptbot|chatgpt-user|oai-searchbot|claudebot|claude-user|perplexitybot|bytespider|ccbot|amazonbot/i, "Robot IA"],
  [/ahrefs|semrush|mj12bot|dotbot|screaming frog|rogerbot/i, "Robot SEO"],
  [/embedly|iframely|redditbot|tumblr|vkshare|w3c_validator|outbrain|quora link preview|nuzzel|bitlybot|flipboard/i, "Aperçu de lien"],
  [/headlesschrome|phantomjs|puppeteer|playwright/i, "Navigateur automatisé"],
  [/curl\/|wget\/|python-requests|python-urllib|go-http-client|okhttp|java\/|axios\/|node-fetch|undici|libwww|httpclient/i, "Script HTTP"],
  [/\b(bot|crawler|spider|crawl|preview|fetch|monitor|uptime)\b/i, "Robot"],
];

export interface ParsedUa {
  isBot: boolean;
  device: "mobile" | "tablet" | "desktop" | "bot";
  browser: string;
  os: string;
}

export function parseUa(ua: string): ParsedUa {
  if (!ua.trim()) return { isBot: true, device: "bot", browser: "Inconnu", os: "" };
  for (const [re, name] of BOTS) if (re.test(ua)) return { isBot: true, device: "bot", browser: name, os: "" };

  const os = /iphone|ipad|ipod/i.test(ua)
    ? "iOS"
    : /android/i.test(ua)
      ? "Android"
      : /windows/i.test(ua)
        ? "Windows"
        : /mac os x|macintosh/i.test(ua)
          ? "macOS"
          : /cros/i.test(ua)
            ? "ChromeOS"
            : /linux/i.test(ua)
              ? "Linux"
              : "Autre";

  const tablet = /ipad|tablet|kindle|silk|playbook/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua));
  const mobile = !tablet && /mobi|iphone|ipod|android|windows phone|blackberry/i.test(ua);
  const device = tablet ? "tablet" : mobile ? "mobile" : "desktop";

  // Navigateurs intégrés aux applis d'abord (ils imitent Safari / Chrome)
  const browser = /instagram/i.test(ua)
    ? "Instagram"
    : /fban|fbav|fb_iab|fbios/i.test(ua)
      ? "Facebook"
      : /linkedinapp/i.test(ua)
        ? "LinkedIn"
        : /musical_ly|bytedancewebview|tiktok/i.test(ua)
          ? "TikTok"
          : /snapchat/i.test(ua)
            ? "Snapchat"
            : /pinterest/i.test(ua)
              ? "Pinterest"
              : /gsa\//i.test(ua)
                ? "Google (appli)"
                : /edg(e|a|ios)?\//i.test(ua)
                  ? "Edge"
                  : /opr\/|opera/i.test(ua)
                    ? "Opera"
                    : /samsungbrowser/i.test(ua)
                      ? "Samsung Internet"
                      : /firefox|fxios/i.test(ua)
                        ? "Firefox"
                        : /chrome|crios|chromium/i.test(ua)
                          ? "Chrome"
                          : /safari/i.test(ua)
                            ? "Safari"
                            : "Autre";

  return { isBot: false, device, browser, os };
}
