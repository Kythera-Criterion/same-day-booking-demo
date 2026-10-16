'use client';

// 将来構想のプレビュー「話しかけて探す」：ブラウザの音声入力（Web Speech API・日本語）か文字入力で探す

import { useEffect, useRef, useState } from 'react';
import { parseVoice, type VoiceQuery } from '@/lib/voice-parse';
import type { WindowKey } from '@/lib/time';
import Button from '@/components/ui/Button';
import Label from '@/components/ui/Label';
import Notice from '@/components/ui/Notice';
import { Input } from '@/components/ui/Form';
import { MagnifyingGlass, Microphone } from '@/components/ui/icons';
import s from './VoiceSearch.module.css';

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognition(): Recognition | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export default function VoiceSearch({ onResult }: { onResult: (window: WindowKey, menu: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<VoiceQuery | null>(null);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    setSupported(getRecognition() !== null);
  }, []);

  function listen() {
    const r = getRecognition();
    if (!r) return;
    setError(null);
    r.lang = 'ja-JP';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      const said = Array.from(e.results)
        .map((res) => res[0]?.transcript ?? '')
        .join('');
      setText(said);
      setParsed(parseVoice(said));
    };
    r.onerror = (e) => setError(e.error === 'not-allowed' ? 'マイクの使用が許可されていません。文字で入力してください。' : '聞き取れませんでした。');
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  }

  function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    const q = parseVoice(text);
    setParsed(q);
    onResult(q.window, q.menu);
  }

  if (!open) {
    return (
      <button type="button" className={s.entry} onClick={() => setOpen(true)}>
        <MagnifyingGlass size={20} aria-hidden focusable="false" />
        <span className={s.entryText}>話しかけて探す（プレビュー）</span>
        <span className={s.mic} aria-hidden>
          <Microphone size={20} weight="duotone" />
        </span>
      </button>
    );
  }

  return (
    <section className={s.panel} aria-label="話しかけて探す（プレビュー）">
      <div className={s.head}>
        <p className={s.title}>
          <Microphone size={20} weight="duotone" aria-hidden focusable="false" />
          話しかけて探す
        </p>
        <Label kind="state">将来構想のプレビュー</Label>
      </div>
      <p className={s.sub}>例：「1時間以内に駅の近くでカット」。言葉の決まりで読み取ります（外部の AI は使いません）。</p>
      <form onSubmit={submit} className={s.form}>
        <Input
          aria-label="いつ・何をしたいか"
          value={text}
          placeholder="いつ・何をしたいかを入力"
          onChange={(e) => {
            setText(e.target.value);
            setParsed(e.target.value ? parseVoice(e.target.value) : null);
          }}
        />
        {supported && (
          <Button
            variant={listening ? 'danger' : 'secondary'}
            size="md"
            icon={Microphone}
            iconWeight={listening ? 'fill' : 'regular'}
            onClick={() => (listening ? rec.current?.stop() : listen())}
            aria-label={listening ? '聞き取りをやめる' : '話しかける'}
          >
            {listening ? '停止' : '話す'}
          </Button>
        )}
      </form>
      {parsed && (
        <p className={s.parsed}>
          読み取った内容：{parsed.matched.length ? parsed.matched.join(' ・ ') : '（時間帯の指定なし → 1時間以内）'}
        </p>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button variant="primary" size="md" block icon={MagnifyingGlass} disabled={!text.trim()} onClick={submit}>
        この内容で探す
      </Button>
    </section>
  );
}
