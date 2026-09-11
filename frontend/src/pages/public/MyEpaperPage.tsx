import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "@/features/epaper/api";
import { useAuth } from "@/stores/auth";
import { useI18n } from "@/i18n";
import type { UserEdition, UserEditionPreference } from "@/types/epaper";

export default function MyEpaperPage() {
  const { language } = useI18n();
  const en = language === "en";
  const me = useAuth((s) => s.me);
  const qc = useQueryClient();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [time, setTime] = useState("06:00");
  const [preferences, setPreferences] = useState<UserEditionPreference[]>([]);
  const options = useQuery({
    queryKey: ["epaper-options"],
    queryFn: api.fetchEpaperOptions,
  });
  const saved = useQuery({
    queryKey: ["my-epapers"],
    queryFn: api.fetchMyEditions,
    enabled: Boolean(me),
  });
  const payload = () => ({
    name,
    auto_generate: true,
    generation_time: `${time}:00`,
    preferences: preferences.map((x, i) => ({ ...x, priority: i })),
  });
  const create = useMutation({
    mutationFn: () => api.createMyEdition(payload()),
    onSuccess: () => {
      setName("");
      setPreferences([]);
      void qc.invalidateQueries({ queryKey: ["my-epapers"] });
    },
  });
  const generate = useMutation({
    mutationFn: api.generateMyEdition,
    onSuccess: (e) => nav(`/my-epaper/edition/${e.id}`),
  });
  const update = useMutation({
    mutationFn: ({ row, next }: { row: UserEdition; next: string }) =>
      api.updateMyEdition(row.id, {
        name: next,
        auto_generate: row.auto_generate,
        generation_time: row.generation_time,
        preferences: row.preferences,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-epapers"] }),
  });
  const toggle = (
    type: UserEditionPreference["preference_type"],
    target_id: number,
  ) =>
    setPreferences((current) =>
      current.some(
        (x) => x.preference_type === type && x.target_id === target_id,
      )
        ? current.filter(
            (x) => !(x.preference_type === type && x.target_id === target_id),
          )
        : [
            ...current,
            { preference_type: type, target_id, priority: current.length },
          ],
    );
  const chosen = (type: UserEditionPreference["preference_type"], id: number) =>
    preferences.some((x) => x.preference_type === type && x.target_id === id);
  if (!me)
    return (
      <main className="mx-auto max-w-xl p-10 text-center">
        <h1 className="th text-2xl font-bold">
          {en
            ? "Sign in to create your E-Paper"
            : "మీ ఈ-పేపర్ సృష్టించడానికి లాగిన్ అవ్వండి"}
        </h1>
        <Link
          to="/login"
          className="mt-5 inline-block rounded bg-brand px-5 py-3 text-white"
        >
          {en ? "Sign in" : "లాగిన్"}
        </Link>
      </main>
    );
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-2 text-sm ${active ? "border-brand bg-brand text-white" : "border-rule bg-white"}`;
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="th text-[30px] font-extrabold">
        {en ? "Create My E-Paper" : "నా ఈ-పేపర్ సృష్టించండి"}
      </h1>
      <p className="te mt-2 text-muted">
        {en
          ? "Choose categories and places once. Fresh published news is prepared automatically every morning."
          : "విభాగాలు, ప్రాంతాలను ఒకసారి ఎంచుకోండి. ప్రతి ఉదయం తాజా ప్రచురిత వార్తలతో ఎడిషన్ సిద్ధమవుతుంది."}
      </p>
      <section className="mt-6 rounded-card border bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <label className="font-bold">
            {en ? "Edition name" : "ఎడిషన్ పేరు"}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                en ? "Ajay's Morning Edition" : "అజయ్ మార్నింగ్ ఎడిషన్"
              }
              className="mt-2 block w-full rounded-control border p-3"
            />
          </label>
          <label className="font-bold">
            {en ? "Daily time" : "రోజువారీ సమయం"}
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="mt-2 block w-full rounded-control border p-3"
            />
          </label>
        </div>
      <Picker title={en ? "Categories & interests" : "విభాగాలు & ఆసక్తులు"}>
          {options.data?.categories.map((x) => (
            <button
              key={x.id}
              onClick={() => toggle("category", x.id)}
              className={chip(chosen("category", x.id))}
            >
              {en ? x.name_en : x.name_te}
            </button>
          ))}
      </Picker>
      <Picker title={en ? "Topics" : "అంశాలు"}>
        {options.data?.tags.map((x) => <button key={x.id} onClick={() => toggle("tag", x.id)} className={chip(chosen("tag", x.id))}>{en ? x.name_en : x.name_te}</button>)}
      </Picker>
        <Picker title={en ? "Districts / locations" : "జిల్లాలు / ప్రాంతాలు"}>
          {options.data?.districts.map((x) => (
            <button
              key={x.id}
              onClick={() => toggle("district", x.id)}
              className={chip(chosen("district", x.id))}
            >
              {en ? x.name_en : x.name_te}
            </button>
          ))}
        </Picker>
        <Picker title={en ? "Mandals" : "మండలాలు"}>
          {options.data?.mandals.map((x) => (
            <button
              key={x.id}
              onClick={() => toggle("mandal", x.id)}
              className={chip(chosen("mandal", x.id))}
            >
              {en ? x.name_en : x.name_te}
            </button>
          ))}
        </Picker>
        <button
          disabled={
            name.trim().length < 2 || !preferences.length || create.isPending
          }
          onClick={() => create.mutate()}
          className="mt-5 rounded-control bg-brand px-5 py-3 font-bold text-white disabled:opacity-40"
        >
          {en ? "Save daily edition" : "రోజువారీ ఎడిషన్ సేవ్ చేయండి"}
        </button>
      </section>
      <h2 className="th mt-8 text-2xl font-bold">
        {en ? "My Editions" : "నా ఎడిషన్లు"}
      </h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {saved.data?.items
          .filter((x) => x.is_active)
          .map((row) => (
            <article key={row.id} className="rounded-card border bg-white p-4">
              <h3 className="th text-xl font-bold">{row.name}</h3>
              <p className="mt-1 text-xs text-muted">
                {row.preferences.length}{" "}
                {en ? "preferences · daily at" : "అభిరుచులు · ప్రతిరోజూ"}{" "}
                {row.generation_time}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => generate.mutate(row.id)}
                  className="rounded bg-brand px-3 py-2 text-sm font-bold text-white"
                >
                  {en ? "Generate / read today" : "ఈ రోజు రూపొందించి చదవండి"}
                </button>
                <button
                  onClick={() => {
                    const next = window.prompt(
                      en ? "Rename edition" : "ఎడిషన్ పేరు మార్చండి",
                      row.name,
                    );
                    if (next?.trim()) update.mutate({ row, next: next.trim() });
                  }}
                  className="rounded border px-3 py-2 text-sm"
                >
                  {en ? "Rename" : "పేరు మార్చు"}
                </button>
                <button
                  onClick={() =>
                    api
                      .deleteMyEdition(row.id)
                      .then(() =>
                        qc.invalidateQueries({ queryKey: ["my-epapers"] }),
                      )
                  }
                  className="rounded border px-3 py-2 text-sm text-breaking"
                >
                  {en ? "Delete" : "తొలగించు"}
                </button>
              </div>
            </article>
          ))}
      </div>
    </main>
  );
}

function Picker({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="mt-5 font-bold">{title}</h2>
      <div className="mt-3 flex max-h-44 flex-wrap gap-2 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
