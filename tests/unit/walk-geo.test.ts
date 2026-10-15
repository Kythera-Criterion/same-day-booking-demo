import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaveBy, walkMinutes } from '../../lib/walk.ts';
import { bearingDeg, distanceKm } from '../../lib/geo.ts';

test('徒歩は80mを1分として切り上げる', () => {
  assert.equal(walkMinutes(0.56), 7);
  assert.equal(walkMinutes(0.08), 1);
  assert.equal(walkMinutes(0), 1);
});

test('出発の目安は、開始から徒歩と余裕5分を引いて5分単位に切り下げる', () => {
  const start = new Date('2026-10-15T05:30:00Z'); // 14:30 JST
  assert.equal(leaveBy(start, 7).toISOString(), '2026-10-15T05:15:00.000Z'); // 14:30 - 12分 = 14:18 → 14:15
  assert.equal(leaveBy(start, 5, 0).toISOString(), '2026-10-15T05:25:00.000Z');
});

test('方位：北は0度、東は90度、南は180度、西は270度', () => {
  const o = { lat: 34.66, lng: 133.92 };
  assert.ok(Math.abs(bearingDeg(o, { lat: 34.67, lng: 133.92 }) - 0) < 0.5);
  assert.ok(Math.abs(bearingDeg(o, { lat: 34.66, lng: 133.93 }) - 90) < 0.5);
  assert.ok(Math.abs(bearingDeg(o, { lat: 34.65, lng: 133.92 }) - 180) < 0.5);
  assert.ok(Math.abs(bearingDeg(o, { lat: 34.66, lng: 133.91 }) - 270) < 0.5);
});

test('距離：緯度0.01度はおよそ1.11km', () => {
  const d = distanceKm({ lat: 34.66, lng: 133.92 }, { lat: 34.67, lng: 133.92 });
  assert.ok(Math.abs(d - 1.112) < 0.01);
});
