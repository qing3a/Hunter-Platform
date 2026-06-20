// tests/unit/lib-html.test.ts
import { describe, it, expect } from 'vitest';
import { esc, html } from '../../src/main/modules/view/templates/lib/html';

describe('esc', () => {
  it('escapes HTML special characters', () => {
    expect(esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });
  it('escapes single quotes', () => {
    expect(esc("it's")).toBe('it&#39;s');
  });
  it('returns empty string for null', () => { expect(esc(null)).toBe(''); });
  it('returns empty string for undefined', () => { expect(esc(undefined)).toBe(''); });
  it('stringifies numbers', () => { expect(esc(42)).toBe('42'); });
  it('preserves safe characters', () => { expect(esc('hello world')).toBe('hello world'); });
});

describe('html tagged template', () => {
  it('concatenates strings and values', () => {
    const out = html`<p>${'hello'}</p>`;
    expect(out).toBe('<p>hello</p>');
  });
  it('escapes interpolated values', () => {
    const out = html`<p>${'<b>'}</p>`;
    expect(out).toBe('<p>&lt;b&gt;</p>');
  });
  it('skips null and false', () => {
    expect(html`a${null}b${false}c`).toBe('abc');
  });
  it('flattens arrays', () => {
    const items = ['<x>', '<y>'];
    expect(html`${items}`).toBe('&lt;x&gt;&lt;y&gt;');
  });
  it('preserves numbers as-is', () => {
    expect(html`count: ${42}`).toBe('count: 42');
  });
});