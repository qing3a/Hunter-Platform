// src/main/modules/view/templates/partials/ranking-row.ts
import { html } from '../lib/html.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export function rankingRow(rank: number, name: string, meta: string, score: number | string): string {
  const medal = rank >= 1 && rank <= 3 ? MEDALS[rank - 1] : `${rank}.`;
  return html`
    <div class="ranking-row">
      <div class="ranking-medal">${medal}</div>
      <div class="ranking-info">
        <div class="ranking-name">${name}</div>
        <div class="ranking-meta">${meta}</div>
      </div>
      <div class="ranking-rep">${score}</div>
    </div>
  `;
}