import { load } from 'cheerio';
import { publicFetch } from './public-fetch';
export interface SourceCandidate {
  title: string;
  url: string;
  scope: string;
  alternatives?: string[];
}
export interface SourceProvider {
  name: string;
  count: number;
  status: 'ok' | 'empty' | 'error';
  message: string;
}
export function sourceError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/abort|timeout|超时/i.test(message)) return '连接超时，可稍后重试或检查代理';
  if (/429/.test(message)) return '来源服务限流，请稍后重试';
  if (/401|403/.test(message)) return '来源拒绝访问，可能需要登录或不允许自动读取';
  if (/404/.test(message)) return '该版本全文不存在';
  if (/ENOTFOUND|EAI_AGAIN|解析|公网地址/i.test(message)) return '域名解析失败，请检查网络或代理';
  if (/ECONN|fetch failed|network|socket|TLS|certificate/i.test(message))
    return '网络连接失败，请检查网络或代理';
  if (/来源|正文|公开|内网|地址|PDF/i.test(message)) return message.slice(0, 160);
  return '来源响应无法读取，请更换公开全文链接';
}
// Only title/query variants leave the machine; never upload manuscript paragraphs for discovery.
export function searchQueries(input: string) {
  const original = input
    .normalize('NFKC')
    .replace(/\.(?:docx?|pdf)$/i, '')
    .replace(/["“”‘’(){}\[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  const terms = original.match(/[A-Za-z][A-Za-z0-9+-]{2,}/g) || [];
  const stop =
    /^(?:the|and|for|with|from|into|that|this|review|research|progress|study|version|docx|pdf)$/i;
  const concise = [...new Set(terms.filter((t) => !stop.test(t)))].slice(0, 5).join(' ');
  return [...new Set([original, concise].filter((q) => q.length >= 2))].slice(0, 2);
}
type Fetcher = typeof publicFetch;
interface Location {
  is_oa?: boolean;
  pdf_url?: string | null;
  landing_page_url?: string | null;
}
export async function discoverSources(
  query: string,
  signal?: AbortSignal,
  fetcher: Fetcher = publicFetch,
) {
  const queries = searchQueries(query),
    candidates: SourceCandidate[] = [],
    providers: SourceProvider[] = [];
  const provider = async (name: string, search: (q: string) => Promise<SourceCandidate[]>) => {
    let found: SourceCandidate[] = [],
      lastError: unknown;
    for (const q of queries) {
      signal?.throwIfAborted();
      try {
        found = await search(q);
        if (found.length) break;
        lastError = undefined;
      } catch (error) {
        signal?.throwIfAborted();
        lastError = error;
        break;
      }
    }
    candidates.push(...found);
    providers.push({
      name,
      count: found.length,
      status: found.length ? 'ok' : lastError ? 'error' : 'empty',
      message: found.length
        ? `找到 ${found.length} 个开放全文候选`
        : lastError
          ? sourceError(lastError)
          : '没有找到可读取全文的候选；可缩短检索词或补充链接',
    });
  };
  await Promise.all([
    provider('Europe PMC', async (q) => {
      const endpoint = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
      endpoint.search = new URLSearchParams({
        query: `(${q}) AND OPEN_ACCESS:Y`,
        format: 'json',
        pageSize: '5',
      }).toString();
      const payload = JSON.parse((await fetcher(endpoint.href, signal)).bytes.toString());
      if (!payload.resultList || !Array.isArray(payload.resultList.result))
        throw new Error('来源响应格式无效');
      return payload.resultList.result
        .filter((item: { pmcid?: string }) => /^PMC\d+$/.test(item.pmcid || ''))
        .map((item: { pmcid: string; title?: string }) => ({
          title: item.title || item.pmcid,
          url: `https://www.ebi.ac.uk/europepmc/webservices/rest/${item.pmcid}/fullTextXML`,
          scope: 'Europe PMC 开放全文',
        }));
    }),
    provider('OpenAlex', async (q) => {
      const endpoint = new URL('https://api.openalex.org/works');
      endpoint.search = new URLSearchParams({
        search: q,
        filter: 'is_oa:true',
        per_page: '5',
        select: 'id,title,best_oa_location,locations',
      }).toString();
      const payload = JSON.parse((await fetcher(endpoint.href, signal)).bytes.toString());
      if (!Array.isArray(payload.results)) throw new Error('来源响应格式无效');
      return payload.results.flatMap(
        (item: { title?: string; best_oa_location?: Location; locations?: Location[] }) => {
          const locations = [item.best_oa_location, ...(item.locations || [])].filter(
            (l): l is Location => !!l && l.is_oa === true,
          );
          const urls = [
            ...new Set(
              locations
                .flatMap((l) => [l.pdf_url, l.landing_page_url])
                .filter((u): u is string => !!u && /^https?:\/\//.test(u)),
            ),
          ].slice(0, 3);
          return urls.length
            ? [
                {
                  title: item.title || '开放论文',
                  url: urls[0],
                  alternatives: urls.slice(1),
                  scope: 'OpenAlex 开放全文链接',
                },
              ]
            : [];
        },
      );
    }),
    provider('arXiv', async (q) => {
      const endpoint = new URL('https://export.arxiv.org/api/query');
      endpoint.search = new URLSearchParams({
        search_query: `all:${q.trim().split(/\s+/).slice(0, 6).join(' AND all:')}`,
        max_results: '4',
      }).toString();
      const response = await fetcher(endpoint.href, signal),
        $ = load(response.bytes.toString(), { xml: true });
      if (!$('feed').length) throw new Error('来源响应格式无效');
      const found: SourceCandidate[] = [];
      $('entry').each((_i, entry) => {
        const id = $(entry)
          .find('id')
          .text()
          .match(/arxiv\.org\/abs\/(\d{4}\.\d+(?:v\d+)?)/)?.[1];
        if (id)
          found.push({
            title: $(entry).find('title').text().trim(),
            url: `https://arxiv.org/html/${id}`,
            alternatives: [`https://arxiv.org/pdf/${id}`],
            scope: 'arXiv HTML / PDF',
          });
      });
      return found;
    }),
  ]);
  const seen = new Set<string>();
  const priority = (scope: string) =>
    scope.startsWith('Europe PMC') ? 0 : scope.startsWith('OpenAlex') ? 1 : 2;
  candidates.sort((a, b) => priority(a.scope) - priority(b.scope));
  const unique = candidates.filter((c) => !seen.has(c.url) && !!seen.add(c.url)).slice(0, 12);
  providers.sort((a, b) => a.name.localeCompare(b.name));
  return {
    candidates: unique,
    providers,
    queries,
    warnings: providers.filter((p) => p.status !== 'ok').map((p) => `${p.name}：${p.message}`),
    scope: '公开论文检索（Europe PMC / OpenAlex / arXiv）；只比对实际取得的正文，不覆盖全网或知网',
  };
}
