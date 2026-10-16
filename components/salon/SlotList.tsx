'use client';

// 今日の枠と予約の一覧（時刻の順）。時刻と状態を正確に確かめるための表示

import { CONVERSATION_PREFS, label } from '@/lib/profile-options';
import { fmtTime, fmtYen } from '@/lib/time';
import { activeBooking, type SalonSlot } from './useSalonData';
import { STATE_LABEL, slotState } from './Timeline';
import { FreshMark, StateIcon, stateClass } from './SlotStateMark';
import t from './SlotList.module.css';

export default function SlotList({
  slots,
  now,
  freshIds,
  showNo,
  onSelect,
}: {
  slots: SalonSlot[];
  now: Date;
  freshIds: string[];
  showNo: boolean;
  onSelect: (slot: SalonSlot) => void;
}) {
  const rows = [...slots].sort((a, b) => a.start_at.localeCompare(b.start_at));
  const nowMs = now.getTime();
  const nextIdx = rows.findIndex((s) => new Date(s.end_at).getTime() > nowMs);

  return (
    <div className={t.wrap}>
      <table className={t.table}>
        <thead>
          <tr>
            <th scope="col">時刻</th>
            <th scope="col">担当</th>
            <th scope="col">メニュー</th>
            <th scope="col">状態</th>
            <th scope="col">お客様</th>
            {showNo && <th scope="col">番号</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const st = slotState(s);
            const b = activeBooking(s);
            const past = new Date(s.end_at).getTime() <= nowMs;
            return (
              <tr
                key={s.id}
                className={`${t.row} ${past ? t.past : ''} ${i === nextIdx ? t.next : ''}`}
                onClick={() => onSelect(s)}
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(s)}
              >
                <td className={t.time}>
                  {fmtTime(s.start_at)}
                  <span>〜{fmtTime(s.end_at)}</span>
                </td>
                <td>{s.stylist?.name ?? '—'}</td>
                <td>
                  {s.menu?.name}
                  <small className="num">{fmtYen(s.price)}</small>
                </td>
                <td>
                  <span className={t.cellRow}>
                    <span className={`${t.state} ${stateClass(st)}`}>
                      <StateIcon state={st} />
                      {STATE_LABEL[st] ?? st}
                    </span>
                    {b && freshIds.includes(b.id) && <FreshMark />}
                  </span>
                </td>
                <td>
                  {b ? (
                    <>
                      {b.contact_name} 様
                      {b.conversation_pref && <small>{label(CONVERSATION_PREFS, b.conversation_pref)}</small>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                {showNo && <td className={t.no}>{b?.booking_no ?? '—'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
