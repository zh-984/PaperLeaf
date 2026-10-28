// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { ReportView } from '@/components/report-view';
import { reportDefinitions, type PaperDetail } from '@/lib/types';

afterEach(cleanup);
const paper: PaperDetail = {
  id: 'test',
  title: '<img src=x onerror=alert(1)>',
  fileName: 'test.pdf',
  fileSize: 1000,
  pageCount: 3,
  lastPage: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  notes: [],
  history: [],
  report: {
    status: 'complete',
    sections: [
      {
        key: 'summary',
        title: '一句话总结',
        conclusion: '理解研究',
        points: [{ text: '方法说明', page: 2, quote: 'controlled experiment', verified: true }],
      },
    ],
    progress: '',
    error: '',
    model: 'test',
    tokenUsage: 0,
    version: 1,
    updatedAt: new Date().toISOString(),
  },
};
it('renders all ten sections, escapes document text, and navigates verified evidence', () => {
  const jump = vi.fn();
  const { container } = render(
    <ReportView
      paper={paper}
      settings={null}
      onGenerate={vi.fn()}
      generating={false}
      onEvidence={jump}
      onOriginal={vi.fn()}
      onSettings={vi.fn()}
    />,
  );
  for (const [key] of reportDefinitions)
    expect(screen.getByTestId(`section-${key}`)).toBeInTheDocument();
  expect(container.querySelector('img')).toBeNull();
  fireEvent.click(screen.getByText('查看原文依据', { exact: false }));
  expect(jump).toHaveBeenCalledWith(expect.objectContaining({ page: 2, verified: true }));
});
it('shows the AI fallback instead of a broken empty page', () => {
  render(
    <ReportView
      paper={{ ...paper, report: null }}
      settings={null}
      onGenerate={vi.fn()}
      generating={false}
      onEvidence={vi.fn()}
      onOriginal={vi.fn()}
      onSettings={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: '未配置 AI' })).toBeInTheDocument();
  expect(screen.getAllByText('配置 AI 后解锁文献解读')).toHaveLength(10);
});
