'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { AppSettings } from '@/lib/types';
import { Button } from './ui/button';

export function AiSettings({
  settings,
  onSaved,
}: {
  settings: AppSettings | null;
  onSaved: (settings: AppSettings) => void;
}) {
  const [url, setUrl] = useState(settings?.aiBaseUrl || 'https://api.openai.com/v1');
  const [model, setModel] = useState(settings?.aiModel || '');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(clearKey = false) {
    setBusy(true);
    setMessage('');
    try {
      const result = await api<AppSettings>('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ baseUrl: url, model, apiKey: key, clearKey }),
      });
      onSaved(result);
      setKey('');
      setMessage(
        result.aiEnabled
          ? '已保存，立即生效。可以回到文献生成解读。'
          : 'AI 已关闭，阅读与笔记仍可使用。',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="ai-settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="field-label" htmlFor="ai-url">
        API 地址
      </label>
      <input
        className="text-input"
        id="ai-url"
        type="url"
        required
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://api.example.com/v1"
      />
      <label className="field-label" htmlFor="ai-key">
        API Key {settings?.aiHasKey && <small>· 已保存，留空保持原值</small>}
      </label>
      <input
        className="text-input"
        id="ai-key"
        type="password"
        autoComplete="off"
        value={key}
        onChange={(event) => setKey(event.target.value)}
        placeholder={settings?.aiHasKey ? '已保存的 Key 不回显' : '粘贴服务商提供的 Key'}
      />
      <label className="field-label" htmlFor="ai-model">
        模型名称
      </label>
      <input
        className="text-input"
        id="ai-model"
        required
        value={model}
        onChange={(event) => setModel(event.target.value)}
        placeholder="填写服务商提供的模型 ID"
      />
      <p className="reading-presets">
        阅读参数已预设：分段精读与缓存、逐板块报告、依据核对；GLM
        推理模型自动预留思考预算。识别为视觉模型后会读取 PDF 页面图像，无需额外开关。
      </p>
      {message && <p role="status">{message}</p>}
      <div className="dialog-actions">
        {settings?.aiHasKey && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(true)}>
            移除 Key
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? '保存中…' : '保存 AI 配置'}
        </Button>
      </div>
    </form>
  );
}
