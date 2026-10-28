export class ClientError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (typeof options.body === 'string') headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(url, { ...options, headers, cache: 'no-store' });
  } catch {
    throw new ClientError('无法连接本机服务，请检查服务是否正在运行', 0);
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw new ClientError(data.error || `请求失败 (${response.status})`, response.status);
  return data as T;
}
