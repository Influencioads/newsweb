import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Share2 } from "lucide-react";
import type { Poll } from "@/types/epaper";
import * as epaperApi from "./api";
import { useI18n } from "@/i18n";

export function PollCard({
  poll,
  className = "",
}: {
  poll: Poll;
  className?: string;
}) {
  const { language } = useI18n();
  const en = language === "en";
  const [current, setCurrent] = useState(poll);
  const vote = useMutation({
    mutationFn: (optionId: number) => epaperApi.votePoll(current.id, optionId),
    onSuccess: setCurrent,
  });
  const show = current.has_voted || current.status !== "ACTIVE";
  const share = () =>
    navigator.share?.({
      title: en ? "Big Question" : "బిగ్ క్వశ్చన్",
      text: en
        ? current.question_en || current.question_te
        : current.question_te,
      url: `${location.origin}/polls/${current.id}`,
    });
  return (
    <section
      className={`rounded-card border-2 border-brand/20 bg-white p-5 shadow-card ${className}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="font-sans text-[11px] font-extrabold uppercase tracking-[.16em] text-brand">
          ❓{" "}
          {current.is_big_question
            ? en
              ? "Big Question"
              : "బిగ్ క్వశ్చన్"
            : en
              ? "Poll"
              : "పోల్"}
        </p>
        <button onClick={share} aria-label="Share poll">
          <Share2 className="h-4 w-4" />
        </button>
      </div>
      <h2 className="th text-[22px] font-extrabold leading-telugu">
        {en ? current.question_en || current.question_te : current.question_te}
      </h2>
      <div className="mt-4 space-y-2">
        {current.options.map((o) => (
          <button
            key={o.id}
            disabled={current.has_voted || vote.isPending}
            onClick={() => vote.mutate(o.id)}
            className={`relative flex min-h-tap w-full overflow-hidden rounded-control border px-4 py-2 text-left ${current.selected_option_id === o.id ? "border-brand text-brand" : "border-rule"}`}
          >
            {show ? (
              <span
                className="absolute inset-y-0 left-0 bg-brand-tint"
                style={{ width: `${o.percentage}%` }}
              />
            ) : null}
            <span className="te relative z-10 font-semibold">
              {en ? o.option_text_en || o.option_text_te : o.option_text_te}
            </span>
            {show ? (
              <span className="relative z-10 ml-auto font-sans font-bold">
                {o.percentage}%
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {vote.isError ? (
        <p role="alert" className="mt-2 text-sm text-breaking">
          {en ? "Your vote could not be recorded." : "మీ ఓటు నమోదు కాలేదు."}
        </p>
      ) : null}
      {show ? (
        <p className="mt-3 font-sans text-[11px] text-muted">
          {current.total_votes} {en ? "votes" : "ఓట్లు"}
        </p>
      ) : null}
    </section>
  );
}
