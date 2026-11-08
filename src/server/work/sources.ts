import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { load } from 'cheerio';
import { ApiError } from '../http';
import { extractPages } from '../pdf';
import { db } from '../db';

export function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  if (isIP(address) === 6) {
    const ip = address.toLowerCase();
    return ip.startsWith('2') || ip.startsWith('3');
  }
  return false;
}
export async function publicFetch(
  value: string,
  signal?: AbortSignal,
  redirects = 0,
): Promise<{ bytes: Buffer; type: string; url: string }> {
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new ApiError(400, '来源必须是公开 HTTP(S) 地址');
  if (redirects > 3) throw new ApiError(422, '来源重定向次数过多');
  const proxyValue =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  const proxy = proxyValue ? new URL(proxyValue) : undefined;
  if (proxy && !['http:', 'https:'].includes(proxy.protocol))
    throw new ApiError(422, '当前代理协议不受支持');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname.includes('.') && !isIP(hostname)) throw new ApiError(400, '来源必须是公开域名');
  // A trusted machine proxy may use fake DNS (198.18/15). Resolve public targets
  // through a fixed DoH endpoint, then CONNECT to that validated IP, never to
  // the untrusted source hostname. Redirects repeat this validation.
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : proxy
      ? await proxyResolve(hostname, proxy, signal)
      : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((item) => !publicAddress(item.address)))
    throw new ApiError(400, '不允许访问本机、内网或保留地址');
  const target = addresses[0];
  const destination = new URL(url);
  if (proxy) destination.hostname = target.family === 6 ? `[${target.address}]` : target.address;
  const result = await sourceRequest(destination, {
    proxy,
    signal,
    hostname,
    lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
    family: target.family,
  });
  if ([301, 302, 303, 307, 308].includes(result.status) && result.location)
    return publicFetch(new URL(result.location, url).href, signal, redirects + 1);
  if (result.status !== 200)
    throw new ApiError(422, `来源返回 HTTP ${result.status}，未取得可比对正文`);
  return { ...result, url: url.href };
}

const dnsCache = new Map<string, { address: string; family: number; expires: number }>();
async function proxyResolve(hostname: string, proxy: URL, signal?: AbortSignal) {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expires > Date.now()) return [cached];
  const endpoint = new URL('https://cloudflare-dns.com/dns-query');
  endpoint.searchParams.set('name', hostname);
  endpoint.searchParams.set('type', 'A');
  const response = await sourceRequest(endpoint, { proxy, signal, hostname: endpoint.hostname });
  if (response.status !== 200) throw new ApiError(422, '公开来源域名解析失败');
  const payload = JSON.parse(response.bytes.toString('utf8'));
  const addresses: { address: string; family: number }[] = (payload.Answer || [])
    .filter(
      (answer: { type: number; data: string }) => answer.type === 1 && isIP(answer.data) === 4,
    )
    .map((answer: { data: string }) => ({ address: answer.data, family: 4 }));
  if (!addresses.length || addresses.some((item) => !publicAddress(item.address)))
    throw new ApiError(400, '来源没有可访问的公网地址');
  if (dnsCache.size > 100) dnsCache.clear();
  dnsCache.set(hostname, { ...addresses[0], expires: Date.now() + 300000 });
  return addresses;
}
function sourceRequest(
  url: URL,
  options: {
    proxy?: URL;
    hostname: string;
    signal?: AbortSignal;
    lookup?: import('node:net').LookupFunction;
    family?: number;
  },
) {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
    : AbortSignal.timeout(20000);
  const agent = options.proxy ? new HttpsProxyAgent(options.proxy) : undefined;
  return new Promise<{
    bytes: Buffer;
    type: string;
    location?: string;
    status: number;
  }>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        headers: {
          'User-Agent': 'PaperleafWork/0.9 (public-source text comparison)',
          'Accept-Encoding': 'identity',
          Accept: options.hostname === 'cloudflare-dns.com' ? 'application/dns-json' : '*/*',
          Host: options.hostname,
        },
        agent,
        servername: options.hostname,
        lookup: options.lookup,
        family: options.family,
        signal,
        timeout: 20000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let length = 0;
        response.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > 3 * 1024 * 1024) {
            response.destroy(new Error('来源超过 3 MiB'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            bytes: Buffer.concat(chunks),
            type: String(response.headers['content-type'] || ''),
            location: response.headers.location,
            status: response.statusCode || 0,
          }),
        );
      },
    );
    request.on('timeout', () => request.destroy(new Error('读取公开来源超时')));
    request.on('error', reject);
    request.end();
  }).finally(() => agent?.destroy());
}
export function extractSourceText(bytes: Buffer, type: string) {
  if (!/text\/|xml|json/i.test(type)) throw new ApiError(422, '来源不是可读取的网页或文本');
  const $ = load(bytes.toString('utf8'), { xml: /xml/i.test(type) });
  $('script,style,nav,header,footer,aside,form,ref-list,reference-list,iframe').remove();
  const title = $('article-title').first().text() || $('title').first().text();
  const root = $('article body,article-body,main,article').first();
  const text = (root.length ? root.text() : $.root().text()).replace(/\s+/g, ' ').trim();
  if (text.length < 80) throw new ApiError(422, '来源没有足够正文，不能纳入比对');
  if (text.length > 150000) throw new ApiError(422, '来源正文超过 15 万字符，请改用具体章节页面');
  return { title: title.trim().slice(0, 300) || '公开来源', text };
}
export async function addSource(documentId: string, url: string, signal?: AbortSignal) {
  if ((await db.workSource.count({ where: { documentId } })) >= 12)
    throw new ApiError(400, '每篇稿件最多保留 12 个来源，可先删除不需要的来源');
  const fetched = await publicFetch(url, signal);
  let parsed: { title: string; text: string };
  if (fetched.bytes.subarray(0, 5).toString() === '%PDF-') {
    const pages = await extractPages(fetched.bytes);
    parsed = {
      title: new URL(url).pathname.split('/').at(-1) || '公开 PDF',
      text: pages.map((p) => p.text).join('\n'),
    };
    if (parsed.text.length > 150000) throw new ApiError(422, '来源过长，请选取具体章节');
  } else parsed = extractSourceText(fetched.bytes, fetched.type);
  return db.workSource.upsert({
    where: { documentId_url: { documentId, url: fetched.url } },
    create: { documentId, url: fetched.url, ...parsed },
    update: parsed,
  });
}
export async function discoverSources(query: string, signal?: AbortSignal) {
  const candidates: { title: string; url: string; scope: string }[] = [];
  const warnings: string[] = [];
  const results = await Promise.allSettled([
    (async () => {
      const endpoint = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
      endpoint.searchParams.set('query', `(${query.replace(/["(){}]/g, ' ')}) AND OPEN_ACCESS:Y`);
      endpoint.searchParams.set('format', 'json');
      endpoint.searchParams.set('pageSize', '5');
      const response = await publicFetch(endpoint.href, signal);
      const payload = JSON.parse(response.bytes.toString());
      for (const item of payload.resultList?.result || []) {
        if (typeof item.pmcid === 'string' && /^PMC\d+$/.test(item.pmcid))
          candidates.push({
            title: String(item.title || item.pmcid),
            url: `https://www.ebi.ac.uk/europepmc/webservices/rest/${item.pmcid}/fullTextXML`,
            scope: 'Europe PMC 开放全文',
          });
      }
    })(),
    (async () => {
      const endpoint = new URL('https://export.arxiv.org/api/query');
      endpoint.searchParams.set(
        'search_query',
        `all:${query
          .replace(/["(){}]/g, ' ')
          .trim()
          .split(/\s+/)
          .slice(0, 8)
          .join(' AND all:')}`,
      );
      endpoint.searchParams.set('max_results', '5');
      const response = await publicFetch(endpoint.href, signal);
      const $ = load(response.bytes.toString(), { xml: true });
      $('entry').each((_index, entry) => {
        const id = $(entry)
          .find('id')
          .text()
          .match(/arxiv\.org\/abs\/(\d{4}\.\d+(?:v\d+)?)/)?.[1];
        if (id)
          candidates.push({
            title: $(entry).find('title').text().trim(),
            url: `https://arxiv.org/html/${id}`,
            scope: 'arXiv HTML（部分论文不可用）',
          });
      });
    })(),
  ]);
  results.forEach((result, index) => {
    if (result.status === 'rejected')
      warnings.push(`${index === 0 ? 'Europe PMC' : 'arXiv'} 检索失败，覆盖不完整`);
  });
  return {
    candidates,
    warnings,
    scope: '仅检索 Europe PMC 开放论文及 arXiv，不覆盖全网或知网；候选摘要不计入全文查重率',
  };
}
