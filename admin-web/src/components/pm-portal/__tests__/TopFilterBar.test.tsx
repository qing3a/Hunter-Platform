import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TopFilterBar } from '../TopFilterBar';

describe('TopFilterBar', () => {
  const defaults = { project: '全部', status: '进行中', range: '近 90 天' };

  it('renders the three default chips', () => {
    render(<TopFilterBar onRefresh={vi.fn()} onExport={vi.fn()} onCreate={vi.fn()} {...defaults} />);
    // Project chip is a static <span> with the dropdown caret baked in.
    expect(screen.getByText('📁 项目: 全部 ▾')).toBeInTheDocument();
    // Status / range are real <select> elements — assert via getByLabelText
    // so the assertion stays decoupled from the rendered DOM structure.
    expect(screen.getByLabelText('状态过滤')).toHaveValue('进行中');
    expect(screen.getByLabelText('时间范围')).toHaveValue('近 90 天');
  });

  it('fires onRefresh when 🔄 刷新 is clicked', () => {
    const onRefresh = vi.fn();
    render(<TopFilterBar onRefresh={onRefresh} onExport={vi.fn()} onCreate={vi.fn()} {...defaults} />);
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('fires onExport when 📥 导出 is clicked', () => {
    const onExport = vi.fn();
    render(<TopFilterBar onRefresh={vi.fn()} onExport={onExport} onCreate={vi.fn()} {...defaults} />);
    fireEvent.click(screen.getByRole('button', { name: /导出/ }));
    expect(onExport).toHaveBeenCalledOnce();
  });

  it('fires onCreate when + 新建项目 is clicked', () => {
    const onCreate = vi.fn();
    render(<TopFilterBar onRefresh={vi.fn()} onExport={vi.fn()} onCreate={onCreate} {...defaults} />);
    fireEvent.click(screen.getByRole('button', { name: /新建项目/ }));
    expect(onCreate).toHaveBeenCalledOnce();
  });
});