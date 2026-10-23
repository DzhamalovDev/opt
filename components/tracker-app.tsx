"use client";

import type { User } from "@supabase/supabase-js";
import { del, get, set } from "idb-keyval";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clapperboard,
  Clock3,
  Download,
  FileUp,
  LayoutDashboard,
  Menu,
  NotebookPen,
  TrendingUp,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import NotesApp from "@/components/notes-app";
import { supabase } from "@/lib/supabase";
import {
  createTracker,
  difference,
  type FieldKey,
  formatNumber,
  formatSigned,
  parseTracker,
  parseTrackerSnapshot,
  sumField,
  TASKS,
  type TrackerData,
  type TrackerSnapshot,
  toCsv,
  WEEK_RANGES,
} from "@/lib/tracker";

const STORAGE_KEY = "opt-tracker-v1";
const userStorageKey = (id: string) => `opt-tracker-user-${id}-v1`;
type Section = "plan" | "metrics" | "review";

type CloudTrackerRow = {
  data: unknown;
  updated_at: string;
};

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  area = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  area?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {area ? (
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={3}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type={type}
          inputMode={type === "number" ? "decimal" : undefined}
          min={type === "number" ? 0 : undefined}
        />
      )}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

function SectionTitle({
  kicker,
  title,
  description,
}: {
  kicker: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="section-title">
      <span className="kicker">{kicker}</span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export default function TrackerApp() {
  const [data, setData] = useState<TrackerData>(() => createTracker());
  const [updatedAt, setUpdatedAt] = useState(() => new Date(0).toISOString());
  const dataRef = useRef(data);
  const updatedAtRef = useRef(updatedAt);
  const userRef = useRef<User | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [syncState, setSyncState] = useState<"local" | "syncing" | "synced" | "error">("local");
  const [syncMessage, setSyncMessage] = useState("");
  const syncBusy = useRef(false);
  const syncAgain = useRef(false);
  const syncTimer = useRef<number | undefined>(undefined);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [accountRequest, setAccountRequest] = useState(0);
  const [section, setSection] = useState<Section>("plan");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const synchronize = useCallback(async (account: User) => {
    if (!supabase || userRef.current?.id !== account.id) return;
    if (syncBusy.current) {
      syncAgain.current = true;
      return;
    }
    syncBusy.current = true;
    try {
      do {
        syncAgain.current = false;
        setSyncState("syncing");
        const local: TrackerSnapshot = {
          data: dataRef.current,
          updatedAt: updatedAtRef.current,
        };
        const { data: cloudData, error } = await supabase
          .from("trackers")
          .select("data,updated_at")
          .eq("user_id", account.id)
          .maybeSingle();
        if (error) throw error;
        if (userRef.current?.id !== account.id) return;

        const row = cloudData as CloudTrackerRow | null;
        const remoteData = row ? parseTracker(row.data) : null;
        let next = local;
        if (remoteData && row && row.updated_at > local.updatedAt) {
          next = { data: remoteData, updatedAt: row.updated_at };
        } else if (!remoteData || !row || local.updatedAt > row.updated_at) {
          const nextUpdatedAt =
            local.updatedAt === new Date(0).toISOString()
              ? new Date().toISOString()
              : local.updatedAt;
          const { error: writeError } = await supabase.from("trackers").upsert({
            user_id: account.id,
            data: local.data,
            updated_at: nextUpdatedAt,
          });
          if (writeError) throw writeError;
          next = { data: local.data, updatedAt: nextUpdatedAt };
        }

        if (userRef.current?.id !== account.id) return;
        dataRef.current = next.data;
        updatedAtRef.current = next.updatedAt;
        setData(next.data);
        setUpdatedAt(next.updatedAt);
        await set(userStorageKey(account.id), next);
        await del(STORAGE_KEY);
        setSaveState("saved");
        setSyncState("synced");
        setSyncMessage("");
      } while (syncAgain.current);
    } catch (error) {
      setSyncState("error");
      setSyncMessage(
        error instanceof Error ? error.message : "Не удалось синхронизировать трекер.",
      );
    } finally {
      syncBusy.current = false;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    userRef.current = user;
    setReady(false);
    setStorageError(false);
    setSyncState(user ? "syncing" : "local");
    Promise.all([
      get<unknown>(STORAGE_KEY),
      user ? get<unknown>(userStorageKey(user.id)) : Promise.resolve(undefined),
    ])
      .then(([guestValue, userValue]) => {
        if (!alive) return;
        const guest = parseTrackerSnapshot(guestValue);
        const saved = parseTrackerSnapshot(userValue);
        const snapshot = user
          ? saved && guest
            ? saved.updatedAt >= guest.updatedAt
              ? saved
              : guest
            : (saved ?? guest)
          : guest;
        const next: TrackerSnapshot = snapshot ?? {
          data: createTracker(),
          updatedAt: new Date(0).toISOString(),
        };
        dataRef.current = next.data;
        updatedAtRef.current = next.updatedAt;
        setData(next.data);
        setUpdatedAt(next.updatedAt);
        setSaveState("saved");
        if (user) void synchronize(user);
      })
      .catch(() => {
        if (alive) setStorageError(true);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [user, synchronize]);

  useEffect(() => {
    if (!ready || storageError) return;
    const timer = window.setTimeout(() => {
      const snapshot = { data, updatedAt };
      set(user ? userStorageKey(user.id) : STORAGE_KEY, snapshot)
        .then(() => setSaveState("saved"))
        .catch(() => setStorageError(true));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [data, ready, storageError, updatedAt, user]);

  useEffect(() => {
    dataRef.current = data;
    updatedAtRef.current = updatedAt;
    if (!ready || !user) return;
    setSyncState("syncing");
    window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => void synchronize(user), 700);
    return () => window.clearTimeout(syncTimer.current);
  }, [data, ready, synchronize, updatedAt, user]);

  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void synchronize(user);
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user, synchronize]);

  const updateTracker = useCallback((updater: (previous: TrackerData) => TrackerData) => {
    const nextUpdatedAt = new Date().toISOString();
    updatedAtRef.current = nextUpdatedAt;
    setUpdatedAt(nextUpdatedAt);
    setSaveState("saving");
    if (userRef.current) setSyncState("syncing");
    setData((previous) => {
      const next = updater(previous);
      dataRef.current = next;
      return next;
    });
  }, []);

  const updateField = useCallback(
    (weekIndex: number, key: FieldKey, value: string) => {
      updateTracker((previous) => ({
        ...previous,
        weeks: previous.weeks.map((week, index) =>
          index === weekIndex ? { ...week, fields: { ...week.fields, [key]: value } } : week,
        ),
      }));
    },
    [updateTracker],
  );

  const updateCheck = useCallback(
    (weekIndex: number, taskIndex: number) => {
      updateTracker((previous) => ({
        ...previous,
        weeks: previous.weeks.map((week, index) =>
          index === weekIndex
            ? {
                ...week,
                checks: week.checks.map((check, task) => (task === taskIndex ? !check : check)),
              }
            : week,
        ),
      }));
    },
    [updateTracker],
  );

  function updateBaseline(key: keyof TrackerData["baseline"], value: string) {
    updateTracker((previous) => ({
      ...previous,
      baseline: { ...previous.baseline, [key]: value },
    }));
  }

  function openWeek(index: number) {
    setShowNotes(false);
    setSelectedWeek(index);
    setSection("plan");
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openOverview() {
    setShowNotes(false);
    setSelectedWeek(null);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openNotes(showAccount = false) {
    if (showAccount) setAccountRequest((request) => request + 1);
    setShowNotes(true);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function importBackup(file?: File) {
    if (!file) return;
    try {
      const parsed = parseTracker(JSON.parse(await file.text()));
      if (!parsed) throw new Error("Файл не похож на резервную копию трекера.");
      if (!window.confirm("Заменить текущие записи данными из файла?")) return;
      updateTracker(() => parsed);
      setSelectedWeek(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось прочитать файл.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const completedTasks = data.weeks.reduce(
    (sum, week) => sum + week.checks.filter(Boolean).length,
    0,
  );
  const youtubeGrowth = data.weeks.reduce(
    (sum, week) => sum + (difference(week.fields.ytStart, week.fields.ytEnd) ?? 0),
    0,
  );
  const telegramGrowth = data.weeks.reduce(
    (sum, week) => sum + (difference(week.fields.tgStart, week.fields.tgEnd) ?? 0),
    0,
  );
  const hasYoutubeGrowth = data.weeks.some(
    (week) => difference(week.fields.ytStart, week.fields.ytEnd) !== null,
  );
  const hasTelegramGrowth = data.weeks.some(
    (week) => difference(week.fields.tgStart, week.fields.tgEnd) !== null,
  );
  const hours = sumField(data, "hoursActual");
  const hasVideos = data.weeks.some((item) => item.fields.videosPublished.trim() !== "");
  const hasHours = data.weeks.some((item) => item.fields.hoursActual.trim() !== "");
  const week = selectedWeek === null ? null : data.weeks[selectedWeek];
  const fields = week?.fields;
  const progress = week ? week.checks.filter(Boolean).length : 0;

  function boundField(key: FieldKey) {
    return {
      value: fields?.[key] ?? "",
      onChange: (value: string) => selectedWeek !== null && updateField(selectedWeek, key, value),
    };
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <div className="brand">
            <span>
              OPT<span className="brand-dot">.</span>
            </span>
            <span className="brand-muted">/ TRACKER</span>
          </div>
          <button
            type="button"
            className="icon-button mobile-close"
            aria-label="Закрыть меню"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="sidebar-caption">Личный рабочий ритм</div>
        <nav aria-label="Навигация трекера" className="side-nav">
          <button
            type="button"
            className={`nav-link ${selectedWeek === null && !showNotes ? "active" : ""}`}
            onClick={openOverview}
          >
            <LayoutDashboard size={18} />
            <span>Обзор</span>
            <ChevronRight size={15} className="nav-arrow" />
          </button>
          <button
            type="button"
            className={`nav-link ${showNotes ? "active" : ""}`}
            onClick={() => openNotes()}
          >
            <NotebookPen size={18} />
            <span>Мои заметки</span>
            <ChevronRight size={15} className="nav-arrow" />
          </button>
          <a className="nav-link" href="/scripts_dashboard.html">
            <Clapperboard size={18} />
            <span>Сценарии</span>
            <ChevronRight size={15} className="nav-arrow" />
          </a>
          <div className="nav-group-label">
            90 ДНЕЙ{" "}
            <span>
              {completedTasks} / {TASKS.length * WEEK_RANGES.length}
            </span>
          </div>
          <div className="week-list">
            {WEEK_RANGES.map((range, index) => {
              const done = data.weeks[index].checks.filter(Boolean).length;
              return (
                <button
                  type="button"
                  key={range}
                  className={`week-link ${selectedWeek === index ? "active" : ""}`}
                  onClick={() => openWeek(index)}
                >
                  <span className="week-index">
                    {index === 12 ? "F" : String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="week-link-text">
                    <strong>{index === 12 ? "Финал" : `Неделя ${index + 1}`}</strong>
                    <small>{range}</small>
                  </span>
                  {done === TASKS.length ? (
                    <CheckCircle2 size={16} className="week-done" />
                  ) : (
                    <span className="week-count">{done}/7</span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>
        <button
          type="button"
          className={`sidebar-bottom ${syncState === "error" ? "sync-error" : ""}`}
          onClick={() => openNotes(true)}
          title={user?.email ?? "Открыть вход в аккаунт"}
        >
          <span className="sidebar-dot" />
          {user
            ? syncState === "syncing"
              ? "Трекер синхронизируется"
              : syncState === "error"
                ? "Ошибка синхронизации"
                : "Трекер в облаке"
            : "Войти для синхронизации"}
        </button>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          className="mobile-overlay"
          aria-label="Закрыть меню"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button menu-button"
              aria-label="Открыть меню"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              OPT <ChevronRight size={14} />{" "}
              {showNotes
                ? "Мои заметки"
                : selectedWeek === null
                  ? "Обзор"
                  : `Неделя ${selectedWeek + 1}`}
            </span>
          </div>
          {!showNotes && (
            <div className="topbar-right">
              <span
                className={`save-indicator ${storageError || syncState === "error" ? "save-error" : ""}`}
              >
                <span />
                {!ready
                  ? "Загрузка"
                  : syncState === "error"
                    ? "Ошибка синхронизации"
                    : user && syncState === "syncing"
                      ? "Синхронизация"
                      : user && syncState === "synced"
                        ? "В облаке"
                        : storageError
                          ? "Нет автосохранения"
                          : saveState === "saving"
                            ? "Сохраняется"
                            : "Сохранено"}
              </span>
              <button
                type="button"
                className="top-icon"
                title="Скачать резервную копию"
                aria-label="Скачать резервную копию"
                onClick={() =>
                  download(
                    "opt-tracker-backup.json",
                    JSON.stringify(data, null, 2),
                    "application/json",
                  )
                }
              >
                <Download size={18} />
              </button>
            </div>
          )}
        </header>

        <main className="content">
          {!showNotes && storageError && (
            <div className="alert">
              {user
                ? "Локальный кеш браузера недоступен. Данные аккаунта продолжат сохраняться в облаке."
                : "Автосохранение в этом браузере недоступно. Войдите в аккаунт для облачного сохранения."}
            </div>
          )}
          {!showNotes && syncState === "error" && (
            <div className="alert">
              Не удалось синхронизировать трекер. Локальная версия сохранена. {syncMessage}
            </div>
          )}
          {showNotes ? (
            <NotesApp user={user} accountRequest={accountRequest} />
          ) : !ready ? (
            <div className="loading">Загружаем трекер…</div>
          ) : selectedWeek === null ? (
            <>
              <div className="page-head">
                <div>
                  <span className="eyebrow">
                    <span className="eyebrow-line" /> 12 ОКТЯБРЯ 2026 — 9 ЯНВАРЯ 2027
                  </span>
                  <h1>
                    Твоя работа.
                    <br />
                    <em>В одном ритме.</em>
                  </h1>
                  <p>
                    Один экран для курса на 90 дней. Выбирай неделю, отмечай сделанное и смотри на
                    реальные цифры.
                  </p>
                </div>
                <button type="button" className="primary-button" onClick={() => openWeek(0)}>
                  Открыть неделю 1 <ArrowRight size={18} />
                </button>
              </div>

              <div className="stats-grid">
                <StatCard
                  icon={<Video size={21} />}
                  label="Опубликовано видео"
                  value={hasVideos ? formatNumber(sumField(data, "videosPublished")) : "—"}
                  sub="за весь период"
                />
                <StatCard
                  icon={<TrendingUp size={21} />}
                  label="Рост YouTube"
                  value={hasYoutubeGrowth ? formatSigned(youtubeGrowth) : "—"}
                  sub="по заполненным неделям"
                />
                <StatCard
                  icon={<Activity size={21} />}
                  label="Рост Telegram"
                  value={hasTelegramGrowth ? formatSigned(telegramGrowth) : "—"}
                  sub="по заполненным неделям"
                />
                <StatCard
                  icon={<Clock3 size={21} />}
                  label="Время в работе"
                  value={hasHours ? `${formatNumber(hours)} ч` : "—"}
                  sub="фактические часы"
                />
              </div>

              <div className="content-heading">
                <div>
                  <span className="kicker">ТВОЙ МАРШРУТ</span>
                  <h2>Недели проекта</h2>
                </div>
                <span className="heading-note">{completedTasks} выполненных действий</span>
              </div>
              <div className="week-grid">
                {WEEK_RANGES.map((range, index) => {
                  const current = data.weeks[index];
                  const done = current.checks.filter(Boolean).length;
                  return (
                    <button
                      type="button"
                      key={range}
                      className="week-card"
                      onClick={() => openWeek(index)}
                    >
                      <div className="week-card-top">
                        <span className="week-card-number">
                          {index === 12 ? "ФИНАЛ" : `НЕДЕЛЯ ${String(index + 1).padStart(2, "0")}`}
                        </span>
                        <ArrowRight size={18} />
                      </div>
                      <strong>{range}</strong>
                      <p>{current.fields.goal || "Поставь одну главную цель на эту неделю"}</p>
                      <div className="week-card-footer">
                        <div className="progress-track">
                          <span style={{ width: `${(done / TASKS.length) * 100}%` }} />
                        </div>
                        <span>
                          {done}/{TASKS.length}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="bottom-grid">
                <div className="panel baseline-panel">
                  <div className="panel-heading">
                    <span className="panel-icon">
                      <BarChart3 size={19} />
                    </span>
                    <div>
                      <h3>Точка старта</h3>
                      <p>Заполни один раз перед началом.</p>
                    </div>
                  </div>
                  <div className="form-grid two-cols">
                    {(
                      [
                        ["youtubeSubscribers", "Подписчики YouTube"],
                        ["youtubeViews28", "Просмотры за 28 дней"],
                        ["telegramSubscribers", "Подписчики Telegram"],
                        ["availableHours", "Часов в неделю"],
                        ["lastVideoDate", "Дата последнего видео"],
                      ] as const
                    ).map(([key, label]) => (
                      <Field
                        key={key}
                        label={label}
                        value={data.baseline[key]}
                        onChange={(value) => updateBaseline(key, value)}
                        placeholder="Не заполнено"
                        type={key === "lastVideoDate" ? "date" : "number"}
                      />
                    ))}
                  </div>
                </div>
                <div className="panel backup-panel">
                  <div className="panel-heading">
                    <span className="panel-icon">
                      <ArrowDownToLine size={19} />
                    </span>
                    <div>
                      <h3>Твои данные — у тебя</h3>
                      <p>
                        {user
                          ? "Подключена синхронизация аккаунта."
                          : "Трекер работает без аккаунта."}
                      </p>
                    </div>
                  </div>
                  <p>
                    {user
                      ? `Изменения синхронизируются для ${user.email ?? "твоего аккаунта"}. Резервная копия остаётся доступна.`
                      : "Записи сохраняются в браузере этого устройства. Войди через «Мои заметки», чтобы синхронизировать их с телефоном."}
                  </p>
                  <div className="backup-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        download(
                          "opt-tracker-backup.json",
                          JSON.stringify(data, null, 2),
                          "application/json",
                        )
                      }
                    >
                      <Download size={17} /> Скачать копию
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => fileInput.current?.click()}
                    >
                      <FileUp size={17} /> Загрузить копию
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        download("opt-tracker-summary.csv", toCsv(data), "text/csv;charset=utf-8")
                      }
                    >
                      <ArrowDownToLine size={16} /> Сводка CSV
                    </button>
                  </div>
                  <input
                    ref={fileInput}
                    className="sr-only"
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => importBackup(event.target.files?.[0])}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="week-head">
                <div className="week-head-copy">
                  <button type="button" className="back-link" onClick={openOverview}>
                    <ArrowLeft size={16} /> К обзору
                  </button>
                  <span className="eyebrow">
                    <span className="eyebrow-line" />{" "}
                    {selectedWeek === 12
                      ? "ФИНАЛ"
                      : `НЕДЕЛЯ ${String(selectedWeek + 1).padStart(2, "0")}`}
                  </span>
                  <h1>{WEEK_RANGES[selectedWeek]}</h1>
                  <p>Одна цель. Семь действий. Цифры и честный разбор.</p>
                </div>
                <div className="week-nav-actions">
                  <button
                    type="button"
                    className="icon-button"
                    disabled={selectedWeek === 0}
                    aria-label="Предыдущая неделя"
                    onClick={() => openWeek(selectedWeek - 1)}
                  >
                    <ArrowLeft size={19} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={selectedWeek === 12}
                    aria-label="Следующая неделя"
                    onClick={() => openWeek(selectedWeek + 1)}
                  >
                    <ArrowRight size={19} />
                  </button>
                </div>
              </div>
              <div className="week-progress-card">
                <div className="week-progress-top">
                  <div>
                    <span>ПРОГРЕСС НЕДЕЛИ</span>
                    <strong>{progress} из 7 действий</strong>
                  </div>
                  <span className="progress-percent">
                    {Math.round((progress / TASKS.length) * 100)}%
                  </span>
                </div>
                <div className="progress-track large">
                  <span style={{ width: `${(progress / TASKS.length) * 100}%` }} />
                </div>
              </div>
              <div className="section-tabs" role="tablist" aria-label="Раздел недели">
                <button
                  type="button"
                  role="tab"
                  aria-selected={section === "plan"}
                  className={section === "plan" ? "active" : ""}
                  onClick={() => setSection("plan")}
                >
                  <CheckCircle2 size={17} /> План и задачи
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={section === "metrics"}
                  className={section === "metrics" ? "active" : ""}
                  onClick={() => setSection("metrics")}
                >
                  <BarChart3 size={17} /> Метрики
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={section === "review"}
                  className={section === "review" ? "active" : ""}
                  onClick={() => setSection("review")}
                >
                  <CalendarDays size={17} /> Итоги и выводы
                </button>
              </div>

              {section === "plan" && (
                <div className="week-layout">
                  <div className="panel focus-panel">
                    <SectionTitle
                      kicker="01 / ФОКУС"
                      title="Главное на эту неделю"
                      description="Одна цель помогает не распыляться по проектам."
                    />
                    <Field
                      label="Главная цель"
                      {...boundField("goal")}
                      placeholder="Что должно быть сделано к воскресенью?"
                      area
                    />
                    <div className="form-grid two-cols">
                      <Field
                        label="Доступно часов"
                        {...boundField("hoursAvailable")}
                        type="number"
                        placeholder="Например, 12"
                      />
                      <Field
                        label="Фактически потрачено"
                        {...boundField("hoursActual")}
                        type="number"
                        placeholder="Заполни в конце недели"
                      />
                    </div>
                    <div className="soft-note">
                      <Clock3 size={17} /> Планируй от доступного времени, а не от идеальной недели.
                    </div>
                  </div>
                  <div className="panel checklist-panel">
                    <SectionTitle
                      kicker="02 / ДЕЙСТВИЯ"
                      title="Чек-лист"
                      description="Отмечай по ходу недели — прогресс обновится сразу."
                    />
                    <div className="task-list">
                      {TASKS.map((task, index) => (
                        <button
                          type="button"
                          className={`task-row ${week?.checks[index] ? "done" : ""}`}
                          key={task}
                          onClick={() => updateCheck(selectedWeek, index)}
                          aria-pressed={week?.checks[index]}
                        >
                          <span className="task-check">
                            {week?.checks[index] ? <Check size={15} /> : <Circle size={18} />}
                          </span>
                          <span>{task}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {section === "metrics" && (
                <div className="metrics-layout">
                  <div className="panel">
                    <SectionTitle
                      kicker="01 / КАНАЛЫ"
                      title="YouTube"
                      description="Заполняй цифры с одинаковым сроком после публикации."
                    />
                    <div className="form-grid two-cols">
                      <Field
                        label="Опубликовано видео"
                        {...boundField("videosPublished")}
                        type="number"
                        placeholder="0"
                      />
                      <Field
                        label="Просмотры за 7 дней"
                        {...boundField("views7")}
                        type="number"
                        placeholder="—"
                      />
                      <Field
                        label="Просмотры за 48 часов"
                        {...boundField("views48")}
                        type="number"
                        placeholder="—"
                      />
                      <Field
                        label="Просмотры за 28 дней"
                        {...boundField("views28")}
                        type="number"
                        placeholder="—"
                      />
                      <Field
                        label="Подписчики в начале"
                        {...boundField("ytStart")}
                        type="number"
                        placeholder="—"
                      />
                      <Field
                        label="Подписчики в конце"
                        {...boundField("ytEnd")}
                        type="number"
                        placeholder="—"
                      />
                    </div>
                    <div className="delta-line">
                      Изменение подписчиков{" "}
                      <strong>
                        {formatSigned(difference(fields?.ytStart ?? "", fields?.ytEnd ?? ""))}
                      </strong>
                    </div>
                    <div className="form-grid two-cols">
                      <Field label="CTR, %" {...boundField("ctr")} type="number" placeholder="—" />
                      <Field
                        label="Поверхность показа"
                        {...boundField("ctrSurface")}
                        placeholder="Главная, поиск…"
                      />
                      <Field
                        label="Средняя длительность"
                        {...boundField("avgView")}
                        placeholder="Например, 3:42"
                      />
                      <Field
                        label="Удержание первых 30 с, %"
                        {...boundField("retention30")}
                        type="number"
                        placeholder="—"
                      />
                    </div>
                    <Field
                      label="Источники трафика и дата"
                      {...boundField("traffic")}
                      placeholder="Данные Studio, дата проверки"
                      area
                    />
                    <Field
                      label="Ссылка на видео"
                      {...boundField("videoUrl")}
                      type="url"
                      placeholder="https://youtube.com/…"
                    />
                  </div>
                  <div className="panel">
                    <SectionTitle kicker="02 / СООБЩЕСТВО" title="Telegram" />
                    <div className="form-grid two-cols">
                      <Field
                        label="Подписчики в начале"
                        {...boundField("tgStart")}
                        type="number"
                        placeholder="—"
                      />
                      <Field
                        label="Подписчики в конце"
                        {...boundField("tgEnd")}
                        type="number"
                        placeholder="—"
                      />
                      <Field
                        label="Опубликовано постов"
                        {...boundField("tgPosts")}
                        type="number"
                        placeholder="—"
                      />
                      <Field
                        label="Переходы из YouTube"
                        {...boundField("ytToTg")}
                        type="number"
                        placeholder="Если измеряются"
                      />
                    </div>
                    <div className="delta-line">
                      Изменение подписчиков{" "}
                      <strong>
                        {formatSigned(difference(fields?.tgStart ?? "", fields?.tgEnd ?? ""))}
                      </strong>
                    </div>
                    <div className="form-grid two-cols">
                      <Field
                        label="Просмотры постов через 48 ч"
                        {...boundField("tgViews48")}
                        placeholder="Число и контекст"
                      />
                      <Field
                        label="Реакции и ответы"
                        {...boundField("tgReactions")}
                        placeholder="Число и контекст"
                      />
                    </div>
                    <Field
                      label="Ссылки на посты"
                      {...boundField("tgUrls")}
                      area
                      placeholder="По одной ссылке на строку"
                    />
                  </div>
                  <div className="panel">
                    <SectionTitle kicker="03 / ОСТАЛЬНОЕ" title="Проекты и деньги" />
                    <div className="form-grid two-cols">
                      <Field
                        label="Задачи: план"
                        {...boundField("tasksPlan")}
                        type="number"
                        placeholder="—"
                      />
                      <Field
                        label="Задачи: факт"
                        {...boundField("tasksFact")}
                        type="number"
                        placeholder="—"
                      />
                      <Field
                        label="YouTube: часы"
                        {...boundField("hoursYt")}
                        type="number"
                        placeholder="—"
                      />
                      <Field
                        label="Telegram: часы"
                        {...boundField("hoursTg")}
                        type="number"
                        placeholder="—"
                      />
                      <Field
                        label="Tech Unpacked: часы"
                        {...boundField("hoursTech")}
                        type="number"
                        placeholder="—"
                      />
                      <Field
                        label="Смешной Кадр: часы"
                        {...boundField("hoursSk")}
                        type="number"
                        placeholder="—"
                      />
                      <Field
                        label="Подтверждённый доход"
                        {...boundField("income")}
                        placeholder="Сумма и валюта"
                      />
                      <Field
                        label="Дата и источник дохода"
                        {...boundField("incomeProof")}
                        placeholder="Транзакция или отчёт"
                      />
                      <Field
                        label="Расходы"
                        {...boundField("expenses")}
                        placeholder="Сумма и валюта"
                      />
                    </div>
                    <Field
                      label="Результаты других проектов и ссылки"
                      {...boundField("otherUrls")}
                      area
                      placeholder="Что вышло и где это посмотреть"
                    />
                    <Field
                      label="Скриншот Studio и дата"
                      {...boundField("studioProof")}
                      placeholder="Файл или ссылка"
                    />
                    <p className="panel-footnote">
                      Доход записывай только при подтверждении. Пустое поле означает отсутствие
                      данных, а не ноль.
                    </p>
                  </div>
                </div>
              )}

              {section === "review" && (
                <div className="week-layout">
                  <div className="panel">
                    <SectionTitle
                      kicker="01 / РЕЗУЛЬТАТ"
                      title="Разбор недели"
                      description="Коротко и честно: что произошло и что меняется дальше."
                    />
                    <Field
                      label="Главный результат"
                      {...boundField("mainResult")}
                      placeholder="Что реально произошло?"
                      area
                    />
                    <div className="form-grid two-cols">
                      <Field
                        label="Что получилось"
                        {...boundField("worked")}
                        placeholder="Что стоит повторить?"
                        area
                      />
                      <Field
                        label="Что не получилось"
                        {...boundField("notWorked")}
                        placeholder="Где было узкое место?"
                        area
                      />
                    </div>
                    <Field
                      label="Одно улучшение"
                      {...boundField("improve")}
                      placeholder="Что конкретно изменишь?"
                    />
                    <Field
                      label="Приоритет следующей недели"
                      {...boundField("nextPriority")}
                      placeholder="Только один главный приоритет"
                    />
                  </div>
                  <div className="panel">
                    <SectionTitle
                      kicker="02 / ЭКСПЕРИМЕНТ"
                      title="Проверка гипотезы"
                      description="Меняй один элемент за раз, чтобы понять результат."
                    />
                    <Field
                      label="Гипотеза"
                      {...boundField("hypothesis")}
                      placeholder="Что предполагаешь?"
                    />
                    <Field label="Что меняю" {...boundField("change")} placeholder="Один элемент" />
                    <Field
                      label="Что оставляю сравнимым"
                      {...boundField("constant")}
                      placeholder="Например, длину ролика"
                    />
                    <Field
                      label="Как и когда измеряю"
                      {...boundField("measure")}
                      placeholder="Метрика и дата"
                    />
                    <Field
                      label="Результат"
                      {...boundField("expResult")}
                      placeholder="Число или наблюдение"
                    />
                    <div className="field">
                      <label htmlFor="experiment-decision">Решение</label>
                      <select
                        id="experiment-decision"
                        value={fields?.decision ?? ""}
                        onChange={(event) =>
                          updateField(selectedWeek, "decision", event.target.value)
                        }
                      >
                        <option value="">Пока нет решения</option>
                        <option>Продолжить</option>
                        <option>Изменить</option>
                        <option>Остановить</option>
                        <option>Мало данных</option>
                      </select>
                    </div>
                    <Field
                      label="Дополнительные заметки"
                      {...boundField("notes")}
                      area
                      placeholder="Только то, что пригодится позже"
                    />
                  </div>
                </div>
              )}
              <div className="week-bottom-nav">
                <button type="button" className="text-button" onClick={openOverview}>
                  <ArrowLeft size={16} /> Все недели
                </button>
                {selectedWeek < 12 && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => openWeek(selectedWeek + 1)}
                  >
                    Следующая неделя <ArrowRight size={16} />
                  </button>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
