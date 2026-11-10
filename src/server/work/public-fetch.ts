import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ApiError } from '../http';

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
          if (length > 6 * 1024 * 1024) {
            response.destroy(new Error('来源超过 6 MiB'));
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
