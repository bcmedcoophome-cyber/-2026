import { env } from 'cloudflare:workers';

type RssCategory = 'education' | 'event' | 'meeting' | 'news';

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function textFrom(block: string, tags: string[]) {
  for (const tag of tags) {
    const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (match) return decodeXml(match[1]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

function linkFrom(block: string) {
  const atomLink = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1];
  const rssLink = textFrom(block, ['link']);
  const candidate = decodeXml(atomLink || rssLink || '').trim();
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function categoryFor(text: string): RssCategory {
  if (/모임|걷기|동아리|소모임|커뮤니티/.test(text)) return 'meeting';
  if (/행사|캠페인|축제|신청|모집|강좌/.test(text)) return 'event';
  if (/교육|예방|인지|치매|건강수칙/.test(text)) return 'education';
  return 'news';
}

function parseFeed(xml: string) {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>|<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, 12).map((block) => {
    const title = textFrom(block, ['title']);
    const description = textFrom(block, ['description', 'summary', 'content']).slice(0, 180);
    const publishedAt = textFrom(block, ['pubDate', 'published', 'updated']);
    const sourceCategory = textFrom(block, ['category']);
    return {
      title: title || '새 소식',
      link: linkFrom(block),
      description,
      publishedAt: Number.isNaN(Date.parse(publishedAt)) ? '' : new Date(publishedAt).toISOString(),
      category: categoryFor(`${title} ${description} ${sourceCategory}`),
    };
  }).filter((item) => item.link);
}

export async function GET() {
  const feedUrl = String(env.RSS_FEED_URL || '').trim();
  if (!feedUrl) return Response.json({ configured: false, items: [] });

  try {
    const url = new URL(feedUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('invalid protocol');
    const response = await fetch(url, {
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9' },
      cf: { cacheTtl: 900, cacheEverything: true },
    });
    if (!response.ok) throw new Error(`feed ${response.status}`);
    const xml = await response.text();
    if (xml.length > 2_000_000) throw new Error('feed too large');
    return Response.json({ configured: true, items: parseFeed(xml) }, {
      headers: { 'cache-control': 'public, max-age=300, s-maxage=900' },
    });
  } catch {
    return Response.json({ configured: true, items: [], error: 'RSS 소식을 불러오지 못했습니다.' }, { status: 502 });
  }
}
