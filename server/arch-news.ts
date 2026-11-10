export type ArchNewsItem = {
  key: string;
  title: string;
  url: string;
  publishedAt: string | null;
};

const ARCH_NEWS_FEED = "https://archlinux.org/feeds/news/";

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/\s+/g, " ")
    .trim();
}

function readTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, "i"));
  return match ? decodeXml(match[1]) : null;
}

export async function fetchArchNews(): Promise<ArchNewsItem[]> {
  const response = await fetch(ARCH_NEWS_FEED, {
    headers: {
      accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
      "user-agent": "Seegson/1.0 (daily Arch Linux News monitor)",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`Arch News returned HTTP ${response.status}`);
  }

  const xml = await response.text();
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map((match): ArchNewsItem | null => {
      const block = match[1];
      const title = readTag(block, "title");
      const url = readTag(block, "link");
      const key = readTag(block, "guid") || url;
      const publishedAt = readTag(block, "pubDate");
      if (!title || !url || !key) return null;
      return { key, title, url, publishedAt };
    })
    .filter((item): item is ArchNewsItem => item !== null);

  if (items.length === 0) {
    throw new Error("Arch News feed did not contain readable RSS items");
  }
  return items;
}

export async function getLatestArchNewsKey(): Promise<string | null> {
  try {
    return (await fetchArchNews())[0]?.key ?? null;
  } catch {
    return null;
  }
}
