import { load } from 'cheerio';
import { ApiError } from '../http';
import { extractPages } from '../pdf';
import { db } from '../db';
import { publicFetch } from './public-fetch';
export { publicFetch, publicAddress } from './public-fetch';
export { discoverSources } from './discovery';
export function extractSourceText(bytes: Buffer, type: string) {
  if (!/text\/|xml|json/i.test(type)) throw new ApiError(422, '来源不是可读取的网页或文本');
  const $ = load(bytes.toString('utf8'), { xml: /xml/i.test(type) });
  $('script,style,nav,header,footer,aside,form,ref-list,reference-list,iframe').remove();
  const title = $('article-title').first().text() || $('title').first().text();
  const root = $('article body,article-body,main,article').first();
  const text = (root.length ? root.text() : $.root().text()).replace(/\s+/g, ' ').trim();
  if (/^(?:access denied|just a moment|robot check|captcha)/i.test(text))
    throw new ApiError(422, '来源返回访问验证页，未取得正文');
  if (text.length < 80) throw new ApiError(422, '来源没有足够正文，不能纳入比对');
  if (text.length > 150000) throw new ApiError(422, '来源正文超过 15 万字符，请改用具体章节页面');
  return { title: title.trim().slice(0, 300) || '公开来源', text };
}
export async function readSource(
  url: string,
  signal?: AbortSignal,
  followPdf = true,
  automatic = false,
): Promise<{ title: string; text: string; url: string }> {
  const fetched = await publicFetch(url, signal);
  if (fetched.bytes.subarray(0, 5).toString() === '%PDF-') {
    const pages = await extractPages(fetched.bytes);
    const text = pages.map((p) => p.text).join('\n');
    if (text.trim().length < 80)
      throw new ApiError(422, 'PDF 没有足够文本层，请换可提取文字的全文');
    if (text.length > 150000) throw new ApiError(422, '来源正文超过 15 万字符');
    return {
      title: new URL(url).pathname.split('/').at(-1)?.slice(0, 300) || '公开 PDF',
      text,
      url: fetched.url,
    };
  }
  if (/html/i.test(fetched.type)) {
    const $ = load(fetched.bytes.toString('utf8'));
    const pdf = $('meta[name="citation_pdf_url"]').attr('content');
    if (followPdf && pdf)
      return readSource(new URL(pdf, fetched.url).href, signal, false, automatic);
    if (automatic) {
      $('script,style,nav,header,footer,aside,.abstract,#abstract').remove();
      if ($('article,main').first().text().trim().length < 1000)
        throw new ApiError(422, '来源只有摘要或元数据，没有可确认的全文');
    }
  }
  return { ...extractSourceText(fetched.bytes, fetched.type), url: fetched.url };
}
export async function addSource(
  documentId: string,
  url: string,
  signal?: AbortSignal,
  title?: string,
  automatic = false,
) {
  const existing = await db.workSource.findUnique({
    where: { documentId_url: { documentId, url } },
  });
  if (existing) return existing;
  if ((await db.workSource.count({ where: { documentId } })) >= 12)
    throw new ApiError(400, '每篇稿件最多保留 12 个来源，可先删除不需要的来源');
  const parsed = await readSource(url, signal, true, automatic);
  const sameText = await db.workSource.findFirst({ where: { documentId, text: parsed.text } });
  if (sameText) return sameText;
  if (title) parsed.title = title.slice(0, 300);
  return db.workSource.upsert({
    where: { documentId_url: { documentId, url: parsed.url } },
    create: { documentId, ...parsed },
    update: { title: parsed.title, text: parsed.text },
  });
}
