'use client';

// 通信が切れたら知らせる（予約や枠の公開が届かないまま気づかない、を防ぐ）
import { useEffect, useState } from 'react';
import { CheckCircle, WifiSlash } from '@/components/ui/icons';
import s from './NetworkBanner.module.css';

export default function NetworkBanner() {
  const [offline, setOffline] = useState(false);
  const [back, setBack] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const off = () => {
      setOffline(true);
      setBack(false);
    };
    const on = () => {
      setOffline(false);
      setBack(true);
      setTimeout(() => setBack(false), 3000);
    };
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => {
      window.removeEventListener('offline', off);
      window.removeEventListener('online', on);
    };
  }, []);

  if (offline) {
    return (
      <p className={`${s.banner} ${s.off}`} role="alert">
        <WifiSlash size={20} aria-hidden focusable="false" />
        インターネットに接続されていません。つながると、自動で最新の状態に戻ります。
      </p>
    );
  }
  if (back) {
    return (
      <p className={`${s.banner} ${s.on}`} role="status">
        <CheckCircle size={20} aria-hidden focusable="false" />
        接続が戻りました
      </p>
    );
  }
  return null;
}
