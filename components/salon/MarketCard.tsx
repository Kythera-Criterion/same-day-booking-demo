"use client";

// 左のメニューの下の案内「もっと多くのお客様に、あなたのサロンを届けましょう」。
// 押すと、お客様のホームの「今すぐ行けるサロン」での見え方（今の公開中の枠で）と、見つけてもらうための手がかりを出す

import { useState } from "react";
import { createPortal } from "react-dom";
import Sheet from "@/components/Sheet";
import { ButtonLink } from "@/components/ui/Button";
import SalonPhoto from "@/components/ui/SalonPhoto";
import { SectionHead, SubText } from "@/components/ui/Surface";
import { ArrowSquareOut, Storefront } from "@/components/ui/icons";
import { fmtTime, fmtYen } from "@/lib/time";
import type { SalonSlot } from "./useSalonData";
import s from "./SalonTools.module.css";

export default function MarketCard({
  salonId,
  salonName,
  slots,
  listed,
  presetCount,
  now,
}: {
  salonId: string;
  salonName: string;
  slots: SalonSlot[];
  listed: boolean;
  presetCount: number;
  now: Date;
}) {
  const [open, setOpen] = useState(false);
  const bookable = slots
    .filter(
      (x) =>
        x.status === "open" &&
        new Date(x.deadline_at).getTime() > now.getTime(),
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const cheapest = bookable.reduce<SalonSlot | null>(
    (m, x) => (!m || x.price < m.price ? x : m),
    null,
  );
  const times = [...new Set(bookable.map((x) => fmtTime(x.start_at)))].slice(
    0,
    3,
  );

  const tips: string[] = [];
  if (!listed) tips.push("掲載中になると、お客様の画面に出ます。");
  if (listed && bookable.length === 0)
    tips.push(
      "今は受付中の枠がないため、お客様の一覧に出ていません。「枠を出す」で公開すると、すぐに並びます。",
    );
  if (bookable.length > 0 && bookable.length < 3)
    tips.push(
      "時刻のちがう枠を3つ出すと、一覧の「本日の空き枠」がそろい、選ばれやすくなります。",
    );
  if (presetCount === 0)
    tips.push(
      "よく出す枠は「いつもの枠」に登録すると、1回押すだけで公開できます。",
    );
  tips.push(
    "受付の締切を短くすると、直前に探しているお客様にも届きます（設定のメニュー）。",
  );

  return (
    <>
      <div className={s.market}>
        <SalonPhoto
          salonId={salonId}
          salonName={salonName}
          variant="square"
          alt=""
          className={s.marketPhoto}
        />
        <div className={s.marketBody}>
          <p className={s.marketText}>
            <span>もっと多くのお客様に、</span>
            <span>あなたのサロンを</span>
            <span>届けましょう</span>
          </p>
          <button
            type="button"
            className={s.marketButton}
            onClick={() => setOpen(true)}
          >
            お客様の画面での見え方を確認する →
          </button>
        </div>
      </div>

      {/* 左のメニューは画面に貼り付く（重なりの層が分かれる）ため、シートはページの一番外に出す */}
      {open &&
        createPortal(
          <Sheet
            label="お客様の画面での見え方"
            title="お客様の画面での見え方"
            narrow
            onClose={() => setOpen(false)}
          >
            <SubText>
              お客様のホームの「今すぐ行けるサロン」には、今の公開中の枠から、このように表示されます。
            </SubText>
            <div className={s.preview} aria-label="表示の見本">
              <SalonPhoto
                salonId={salonId}
                salonName={salonName}
                variant="square"
                alt=""
                className={s.previewPhoto}
              />
              <div className={s.previewBody}>
                <span className={s.previewName}>{salonName}</span>
                {cheapest ? (
                  <span className={`${s.previewMeta} num`}>
                    {fmtYen(cheapest.price)}〜 ・ 約
                    {cheapest.menu?.duration_min ?? "—"}分
                  </span>
                ) : (
                  <span className={s.previewMeta}>
                    受付中の枠がありません（一覧には出ません）
                  </span>
                )}
                {times.length > 0 && (
                  <span className={s.previewSlots}>
                    {times.map((t) => (
                      <span key={t} className={`${s.previewSlot} num`}>
                        {t}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>
            <SectionHead
              icon={Storefront}
              title="見つけてもらうために"
              as="h3"
            />
            <ul className={s.tips}>
              {tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <ButtonLink
              href="/"
              external
              target="_blank"
              rel="noopener"
              variant="secondary"
              size="md"
              block
              icon={ArrowSquareOut}
            >
              お客様の画面を開く（新しいタブ）
            </ButtonLink>
          </Sheet>,
          document.body,
        )}
    </>
  );
}
