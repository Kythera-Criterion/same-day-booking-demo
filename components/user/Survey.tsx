'use client';

// 予約直後の任意アンケート（2問）。回答はサロンには見せず、運営の集計だけに使う

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toMessage } from '@/lib/errors';

type Question = { id: string; body: string; choices: string[] };

function doneKey(bookingId: string) {
  return `survey-done-${bookingId}`;
}

export default function Survey({ client, bookingId }: { client: SupabaseClient; bookingId: string }) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [state, setState] = useState<'open' | 'sending' | 'done' | 'skipped'>('open');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(doneKey(bookingId))) {
        setState('skipped');
        return;
      }
    } catch {
      // 保存先が使えなくても表示は続ける
    }
    client
      .from('survey_questions')
      .select('id,body,choices')
      .order('sort_order')
      .then(({ data }) => setQuestions((data ?? []) as Question[]));
  }, [client, bookingId]);

  function close(next: 'done' | 'skipped') {
    try {
      sessionStorage.setItem(doneKey(bookingId), '1');
    } catch {
      // 何もしない
    }
    setState(next);
  }

  async function submit() {
    setState('sending');
    setError(null);
    const { error: e } = await client.rpc('submit_survey', { p_booking_id: bookingId, p_answers: answers });
    if (e) {
      setError(toMessage(e));
      setState('open');
      return;
    }
    close('done');
  }

  if (state === 'skipped' || !questions || questions.length === 0) return null;
  if (state === 'done') {
    return <p className="notice notice-ok fade-in">ご協力ありがとうございました。</p>;
  }

  return (
    <section className="card survey fade-in" aria-label="アンケート">
      <p className="card-title">よろしければ、2つだけ教えてください</p>
      <p className="card-sub">任意です。お店には伝わりません。サービスの改善だけに使います。</p>
      {questions.map((q) => (
        <fieldset key={q.id} className="survey-q">
          <legend>{q.body}</legend>
          <div className="chips">
            {q.choices.map((c) => (
              <button
                key={c}
                type="button"
                className={`chip ${answers[q.id] === c ? 'chip-on' : ''}`}
                aria-pressed={answers[q.id] === c}
                onClick={() => setAnswers((a) => ({ ...a, [q.id]: c }))}
              >
                {c}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      {error && <p className="notice notice-error">{error}</p>}
      <div className="action-pair">
        <button className="btn btn-quiet" onClick={() => close('skipped')}>
          答えない
        </button>
        <button className="btn btn-primary" disabled={Object.keys(answers).length === 0 || state === 'sending'} onClick={submit}>
          {state === 'sending' ? '送信中…' : '送信する'}
        </button>
      </div>
    </section>
  );
}
