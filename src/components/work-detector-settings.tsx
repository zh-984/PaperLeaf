'use client';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from './ui/button';
export function WorkDetectorSettings({
  disabled,
  onSaved,
  onError,
}: {
  disabled: boolean;
  onSaved: (enabled: boolean) => void;
  onError: (message: string) => void;
}) {
  const loading = useRef(false);
  const [url, setUrl] = useState(''),
    [model, setModel] = useState(''),
    [key, setKey] = useState(''),
    [hasKey, setHasKey] = useState(false),
    [clearKey, setClearKey] = useState(false),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  async function load() {
    if (loaded || loading.current) return;
    loading.current = true;
    try {
      const config = await api<{
        detectorUrl: string;
        detectorModel: string;
        detectorHasKey: boolean;
      }>('/api/work/capabilities');
      setUrl(config.detectorUrl);
      setModel(config.detectorModel === '专用检测器' ? '' : config.detectorModel);
      setHasKey(config.detectorHasKey);
      setLoaded(true);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : '读取失败');
    } finally {
      loading.current = false;
    }
  }
  return (
    <details
      className="work-detector-settings"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary>专用检测器接入（可选）</summary>
      <p>
        已有聊天 API
        可直接用于辅助分析。此处用于连接你自己的真实检测器服务（可在本机运行），不附带订阅或模型下载。
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void api<{ detector: boolean; detectorHasKey: boolean }>('/api/work/detector-settings', {
            method: 'PATCH',
            body: JSON.stringify({ url, model, key, clearKey }),
          })
            .then((config) => {
              setKey('');
              setClearKey(false);
              setHasKey(config.detectorHasKey);
              onSaved(config.detector);
            })
            .catch((cause) => onError(cause instanceof Error ? cause.message : '保存失败'))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          检测器完整接口地址
          <input
            aria-label="检测器接口地址"
            disabled={disabled || busy || !loaded}
            value={url}
            placeholder="http://127.0.0.1:…/detect（留空停用）"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label>
          检测模型名称
          <input
            disabled={disabled || busy || !loaded}
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        <label>
          检测器 API Key
          <input
            type="password"
            disabled={disabled || busy || !loaded}
            autoComplete="off"
            value={key}
            placeholder={hasKey ? '已保存，留空保持' : '可选，仅保存在本机服务端'}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <label className="work-check">
          <input
            type="checkbox"
            disabled={disabled || busy || !loaded}
            checked={clearKey}
            onChange={(event) => setClearKey(event.target.checked)}
          />
          清除已保存 Key
        </label>
        <Button variant="secondary" disabled={disabled || busy || !loaded}>
          {busy ? '保存中…' : '保存检测器配置'}
        </Button>
      </form>
      <small>
        接口需接受 paragraphs: [&#123;id,text&#125;]，返回 results: [&#123;id,score&#125;]；score 为
        0–1 的模型分数。详细接入规范见 README。
      </small>
    </details>
  );
}
