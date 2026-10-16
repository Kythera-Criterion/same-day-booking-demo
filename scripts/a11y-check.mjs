// 主要な画面のアクセシビリティを、axe（@axe-core/playwright）で自動で確かめる（WCAG 2.1 A・AA）
//   使い方：アプリを起動してから npm run test:a11y（DEMO_MODE=true のデモの環境で動かす）
//   ブラウザ：環境変数 CHROME_PATH（なければ Windows の Chrome の既定の場所）
//   画面：お客様（ホーム・候補・予約の確認シート・予約確定・ログイン・新規登録・マイページ）、
//         サロン（ログイン・営業の画面・予約の知らせ・枠を出すシート・設定）、運営（ログイン・実証の数字・掲載希望・サロン）、掲載申込
//   予約を1件作るため、最初と最後に「デモをリセット」を呼ぶ

import { chromium } from 'playwright-core';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.APP_URL || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const results = [];

async function reset() {
  const r = await fetch(`${BASE}/api/demo/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ history: false }) });
  if (!r.ok) throw new Error(`demo reset ${r.status}`);
}

async function check(page, name, include) {
  await page.waitForTimeout(700);
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  results.push({ name, violations });
  const n = violations.reduce((sum, v) => sum + v.nodes.length, 0);
  console.log(`${n === 0 ? '✔' : '✘'} ${name}${n ? `（${violations.length}種類・${n}か所）` : ''}`);
  for (const v of violations) {
    console.log(`    - ${v.id}（${v.impact}）：${v.help}`);
    for (const node of v.nodes.slice(0, 3)) console.log(`        ${node.target.join(' ')}`);
  }
}

const browser = await chromium.launch({ executablePath: CHROME });
try {
  await reset();
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1024, height: 768 },
  ]) {
    const tag = `${viewport.width}px`;
    const ctx = await browser.newContext({ viewport, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const p = await ctx.newPage();

    // 掲載申込・ログイン前の画面
    await p.goto(`${BASE}/apply`);
    await check(p, `掲載申込（${tag}）`);
    await p.goto(`${BASE}/signup`);
    await check(p, `お客様の新規登録（${tag}）`);
    await p.goto(`${BASE}/salon`);
    await p.getByRole('button', { name: 'HAIR ROOM AOI' }).waitFor();
    await check(p, `サロンのログイン（${tag}）`);
    await p.goto(`${BASE}/admin`);
    await p.getByRole('button', { name: '運営（デモ）' }).waitFor();
    await check(p, `運営のログイン（${tag}）`);
    await p.goto(`${BASE}/login`);
    await p.getByRole('button', { name: /山田 花子/ }).waitFor();
    await check(p, `お客様のログイン（${tag}）`);

    // お客様：ホーム → 候補 → 予約の確認シート
    await p.getByRole('button', { name: /山田 花子/ }).click();
    await p.waitForURL(`${BASE}/`);
    await p.getByRole('button', { name: /今から行ける/ }).waitFor();
    await check(p, `お客様のホーム（${tag}）`);
    await p.getByRole('button', { name: /今から行ける/ }).click();
    await check(p, `時間帯を選ぶ（${tag}）`);
    await p.getByRole('button', { name: /今日中/ }).first().click();
    await p.getByRole('button', { name: /を予約する/ }).first().waitFor({ timeout: 15000 });
    await check(p, `候補（${tag}）`);
    await p.getByRole('button', { name: /を予約する/ }).first().click();
    await p.getByRole('dialog').waitFor();
    await check(p, `予約の確認シート（${tag}）`, '[role="dialog"]');
    await p.keyboard.press('Escape');
    await p.goto(`${BASE}/mypage`);
    await p.waitForTimeout(1500);
    await check(p, `マイページ（${tag}）`);
    await ctx.close();
  }

  // 予約確定とサロンの予約の知らせ（1件だけ予約する）
  const ctxS = await browser.newContext({ viewport: { width: 1024, height: 768 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const s = await ctxS.newPage();
  await s.goto(`${BASE}/salon`);
  await s.getByRole('button', { name: 'HAIR ROOM AOI' }).click();
  await s.getByRole('button', { name: '通知音をオンにして始める' }).click();
  await check(s, 'サロンの営業の画面（1024px）');

  const ctxU = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const u = await ctxU.newPage();
  await u.goto(`${BASE}/login`);
  await u.getByRole('button', { name: /山田 花子/ }).click();
  await u.waitForURL(`${BASE}/`);
  await u.getByRole('button', { name: /今から行ける/ }).click();
  await u.getByRole('button', { name: /今日中/ }).first().click();
  await u.getByRole('button', { name: /HAIR ROOM AOI を予約する/ }).first().click();
  const hold = u.getByRole('button', { name: /長押しで確定/ });
  await hold.scrollIntoViewIfNeeded();
  await hold.hover();
  await u.mouse.down();
  await u.waitForTimeout(1700);
  await u.mouse.up();
  await u.waitForURL(/\/booking\//, { timeout: 20000 });
  await u.waitForTimeout(1500);
  await check(u, '予約確定（390px）');

  await s.getByRole('alertdialog').waitFor({ timeout: 20000 });
  await check(s, 'サロンの予約の知らせ（1024px）');
  await s.getByRole('alertdialog').click();
  await s.getByRole('dialog').waitFor();
  await check(s, 'サロンの予約の詳細シート（1024px）', '[role="dialog"]');
  await s.keyboard.press('Escape');
  await s.getByRole('button', { name: /枠を出す/ }).click();
  await s.getByRole('dialog').waitFor();
  await check(s, 'サロンの枠を出すシート（1024px）', '[role="dialog"]');
  await s.keyboard.press('Escape');
  await s.getByRole('button', { name: '設定' }).click();
  await check(s, 'サロンの設定（1024px）');
  await ctxU.close();
  await ctxS.close();

  // 運営
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const a = await ctxA.newPage();
  await a.goto(`${BASE}/admin`);
  await a.getByRole('button', { name: '運営（デモ）' }).click();
  await a.getByRole('navigation', { name: '運営のメニュー' }).waitFor();
  if (await a.getByRole('button', { name: 'あとで' }).count()) await a.getByRole('button', { name: 'あとで' }).click();
  await check(a, '運営：実証の数字（1280px）');
  for (const tab of ['掲載希望', 'サロン', '今日の状況']) {
    await a.getByRole('navigation', { name: '運営のメニュー' }).getByRole('button', { name: new RegExp(`^${tab}`) }).click();
    await check(a, `運営：${tab}（1280px）`);
  }
  await ctxA.close();
} finally {
  await browser.close();
  await reset().catch(() => null);
}

const failed = results.filter((r) => r.violations.length > 0);
console.log(`\n${results.length - failed.length} / ${results.length} 画面で指摘なし`);
process.exitCode = failed.length === 0 ? 0 : 1;
