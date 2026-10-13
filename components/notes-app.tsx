"use client";

import type { User } from "@supabase/supabase-js";
import { get, set } from "idb-keyval";
import {
  ArrowLeft,
  Cloud,
  CloudOff,
  Download,
  LockKeyhole,
  LogOut,
  Pin,
  Plus,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mergeNotes, type Note, newNote, parseNotes } from "@/lib/notes";
import { supabase } from "@/lib/supabase";

const GUEST_KEY = "opt-notes-guest-v1";
const userKey = (id: string) => `opt-notes-user-${id}-v1`;

type CloudRow = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function fromRow(row: CloudRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toRow(note: Note, userId: string) {
  return {
    id: note.id,
    user_id: userId,
    title: note.title,
    body: note.body,
    pinned: note.pinned,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    deleted_at: note.deletedAt,
  };
}

function saveFile(notes: Note[]) {
  const content = JSON.stringify(
    notes.filter((note) => !note.deletedAt),
    null,
    2,
  );
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "opt-notes.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(
    new Date(value),
  );
}

export default function NotesApp() {
  const [user, setUser] = useState<User | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const notesRef = useRef<Note[]>([]);
  const userRef = useRef<User | null>(null);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [syncState, setSyncState] = useState<"local" | "syncing" | "synced" | "error">("local");
  const [syncMessage, setSyncMessage] = useState("");
  const syncBusy = useRef(false);
  const syncAgain = useRef(false);
  const syncTimer = useRef<number | undefined>(undefined);

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
        const { data, error } = await supabase
          .from("notes")
          .select("id,title,body,pinned,created_at,updated_at,deleted_at")
          .eq("user_id", account.id);
        if (error) throw error;
        if (userRef.current?.id !== account.id) return;

        const remote = (data as CloudRow[]).map(fromRow);
        const local = notesRef.current;
        const merged = mergeNotes(local, remote);
        const remoteById = new Map(remote.map((note) => [note.id, note]));
        const changed = merged.filter((note) => {
          const old = remoteById.get(note.id);
          return !old || note.updatedAt > old.updatedAt;
        });
        if (changed.length) {
          const { error: writeError } = await supabase.from("notes").upsert(
            changed.map((note) => toRow(note, account.id)),
            { onConflict: "id" },
          );
          if (writeError) throw writeError;
        }
        if (userRef.current?.id !== account.id) return;
        const latest = mergeNotes(notesRef.current, merged);
        notesRef.current = latest;
        setNotes(latest);
        await set(userKey(account.id), latest);
        await set(GUEST_KEY, []);
        setSyncState("synced");
        setSyncMessage("");
      } while (syncAgain.current);
    } catch (error) {
      setSyncState("error");
      setSyncMessage(
        error instanceof Error ? error.message : "Не удалось синхронизировать заметки.",
      );
    } finally {
      syncBusy.current = false;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    userRef.current = user;
    setReady(false);
    setSyncState(user ? "syncing" : "local");
    Promise.all([
      get<unknown>(GUEST_KEY),
      user ? get<unknown>(userKey(user.id)) : Promise.resolve([]),
    ])
      .then(([guest, saved]) => {
        if (!alive) return;
        const next = user ? mergeNotes(parseNotes(guest), parseNotes(saved)) : parseNotes(guest);
        notesRef.current = next;
        setNotes(next);
        setSelectedId((previous) => (next.some((note) => note.id === previous) ? previous : null));
        setReady(true);
        if (user) void synchronize(user);
      })
      .catch(() => {
        if (!alive) return;
        setReady(true);
        setSyncState("error");
        setSyncMessage("Локальное хранилище недоступно. Проверь настройки браузера.");
      });
    return () => {
      alive = false;
    };
  }, [user, synchronize]);

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

  const updateNotes = useCallback(
    (next: Note[]) => {
      notesRef.current = next;
      setNotes(next);
      const account = userRef.current;
      void set(account ? userKey(account.id) : GUEST_KEY, next).catch(() => {
        setSyncState("error");
        setSyncMessage("Не удалось сохранить заметку на этом устройстве.");
      });
      if (account) {
        setSyncState("syncing");
        window.clearTimeout(syncTimer.current);
        syncTimer.current = window.setTimeout(() => void synchronize(account), 600);
      }
    },
    [synchronize],
  );

  useEffect(
    () => () => {
      window.clearTimeout(syncTimer.current);
      const account = userRef.current;
      if (account) void synchronize(account);
    },
    [synchronize],
  );

  const visible = useMemo(
    () =>
      notes
        .filter((note) => !note.deletedAt)
        .filter((note) => `${note.title} ${note.body}`.toLowerCase().includes(search.toLowerCase()))
        .sort(
          (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
        ),
    [notes, search],
  );
  const selected = notes.find((note) => note.id === selectedId && !note.deletedAt) ?? null;

  function addNote() {
    const note = newNote();
    updateNotes([note, ...notesRef.current]);
    setSelectedId(note.id);
    setSearch("");
    setAccountOpen(false);
  }

  function changeNote(id: string, patch: Partial<Pick<Note, "title" | "body" | "pinned">>) {
    const now = new Date().toISOString();
    updateNotes(
      notesRef.current.map((note) =>
        note.id === id ? { ...note, ...patch, updatedAt: now } : note,
      ),
    );
  }

  function deleteNote(id: string) {
    if (!window.confirm("Удалить эту заметку?")) return;
    const now = new Date().toISOString();
    updateNotes(
      notesRef.current.map((note) =>
        note.id === id ? { ...note, deletedAt: now, updatedAt: now } : note,
      ),
    );
    setSelectedId(null);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setAuthMessage("");
    try {
      const credentials = { email: email.trim(), password };
      if (authMode === "register") {
        const { data, error } = await supabase.auth.signUp(credentials);
        if (error) throw error;
        setAuthMessage(
          data.session
            ? "Аккаунт создан. Заметки синхронизируются."
            : "Проверь почту и подтверди адрес, затем войди.",
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword(credentials);
        if (error) throw error;
        setAuthMessage("");
        setAccountOpen(false);
      }
      setPassword("");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Не удалось войти.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    notesRef.current = [];
    setNotes([]);
    setSelectedId(null);
    setAccountOpen(false);
  }

  return (
    <div className="notes-page">
      <div className="notes-head">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-line" /> ЛИЧНОЕ ПРОСТРАНСТВО
          </span>
          <h1>
            Мои <em>заметки.</em>
          </h1>
          <p>Идеи, планы и мысли — быстро записать и легко найти.</p>
        </div>
        <button type="button" className="primary-button" onClick={addNote} disabled={!ready}>
          <Plus size={18} /> Новая заметка
        </button>
      </div>

      <div className="notes-toolbar">
        <button
          type="button"
          className="account-button"
          onClick={() => setAccountOpen(!accountOpen)}
        >
          <UserRound size={17} /> {user ? user.email : "Войти для синхронизации"}
        </button>
        <span className={`notes-sync notes-sync-${syncState}`}>
          {syncState === "error" ? <CloudOff size={15} /> : <Cloud size={15} />}
          {syncState === "local"
            ? "На этом устройстве"
            : syncState === "syncing"
              ? "Синхронизация…"
              : syncState === "synced"
                ? "В облаке"
                : "Ошибка синхронизации"}
        </span>
        {syncState === "error" && user && (
          <button type="button" className="text-button" onClick={() => void synchronize(user)}>
            Повторить
          </button>
        )}
        <button
          type="button"
          className="notes-export"
          onClick={() => saveFile(notes)}
          title="Скачать заметки"
          aria-label="Скачать заметки"
        >
          <Download size={17} />
        </button>
      </div>

      {syncMessage && <div className="alert">{syncMessage}</div>}

      {accountOpen && (
        <div className="notes-account panel">
          {user ? (
            <>
              <div className="notes-account-copy">
                <LockKeyhole size={18} />
                <div>
                  <strong>Личный аккаунт</strong>
                  <span>{user.email}</span>
                </div>
              </div>
              <p>Заметки доступны после входа с этим же email на телефоне и компьютере.</p>
              <button type="button" className="secondary-button" onClick={() => void signOut()}>
                <LogOut size={16} /> Выйти
              </button>
            </>
          ) : supabase ? (
            <>
              <div className="notes-auth-tabs">
                <button
                  type="button"
                  className={authMode === "login" ? "active" : ""}
                  onClick={() => {
                    setAuthMode("login");
                    setAuthMessage("");
                  }}
                >
                  Войти
                </button>
                <button
                  type="button"
                  className={authMode === "register" ? "active" : ""}
                  onClick={() => {
                    setAuthMode("register");
                    setAuthMessage("");
                  }}
                >
                  Создать аккаунт
                </button>
              </div>
              <form className="notes-auth-form" onSubmit={(event) => void submitAuth(event)}>
                <label>
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
                <label>
                  Пароль
                  <input
                    type="password"
                    autoComplete={authMode === "login" ? "current-password" : "new-password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Не менее 8 символов"
                  />
                </label>
                <button type="submit" className="primary-button" disabled={authBusy}>
                  {authBusy ? "Подожди…" : authMode === "login" ? "Войти" : "Создать аккаунт"}
                </button>
              </form>
              {authMessage && <p className="notes-auth-message">{authMessage}</p>}
              <p>
                После входа локальные заметки добавятся в аккаунт. Используй один и тот же email на
                всех устройствах.
              </p>
            </>
          ) : (
            <p>
              Заметки уже работают на этом устройстве. Для входа и синхронизации нужно подключить
              облачное хранилище.
            </p>
          )}
        </div>
      )}

      {!ready ? (
        <div className="loading">Загружаем заметки…</div>
      ) : (
        <div className="notes-layout">
          <div className={`notes-list-panel panel ${selected ? "notes-mobile-hidden" : ""}`}>
            <div className="notes-search">
              <Search size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по заметкам"
                aria-label="Поиск по заметкам"
              />
            </div>
            <div className="notes-list-count">
              {visible.length} {visible.length === 1 ? "заметка" : "заметок"}
            </div>
            {visible.length ? (
              <div className="notes-list">
                {visible.map((note) => (
                  <button
                    type="button"
                    key={note.id}
                    className={`notes-item ${selectedId === note.id ? "active" : ""}`}
                    onClick={() => setSelectedId(note.id)}
                  >
                    <div>
                      <strong>{note.title.trim() || "Без названия"}</strong>
                      {note.pinned && <Pin size={14} />}
                    </div>
                    <p>{note.body.trim() || "Пустая заметка"}</p>
                    <small>{formatDate(note.updatedAt)}</small>
                  </button>
                ))}
              </div>
            ) : (
              <div className="notes-empty-list">
                {search ? "Ничего не найдено." : "Пока нет заметок. Нажми «Новая заметка»."}
              </div>
            )}
          </div>
          <div className={`notes-editor panel ${!selected ? "notes-editor-empty" : ""}`}>
            {selected ? (
              <>
                <div className="notes-editor-actions">
                  <button type="button" className="notes-back" onClick={() => setSelectedId(null)}>
                    <ArrowLeft size={17} /> Все заметки
                  </button>
                  <span>Изменено {formatDate(selected.updatedAt)}</span>
                  <button
                    type="button"
                    className={selected.pinned ? "active" : ""}
                    onClick={() => changeNote(selected.id, { pinned: !selected.pinned })}
                    title={selected.pinned ? "Открепить" : "Закрепить"}
                    aria-label={selected.pinned ? "Открепить" : "Закрепить"}
                  >
                    <Pin size={17} />
                  </button>
                  <button
                    type="button"
                    className="notes-delete"
                    onClick={() => deleteNote(selected.id)}
                    title="Удалить"
                    aria-label="Удалить"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                <input
                  className="notes-title-input"
                  value={selected.title}
                  maxLength={200}
                  onChange={(event) => changeNote(selected.id, { title: event.target.value })}
                  placeholder="Название заметки"
                  aria-label="Название заметки"
                />
                <textarea
                  className="notes-body-input"
                  value={selected.body}
                  maxLength={50000}
                  onChange={(event) => changeNote(selected.id, { body: event.target.value })}
                  placeholder="Начни писать здесь…"
                  aria-label="Текст заметки"
                />
              </>
            ) : (
              <div className="notes-empty-editor">
                <span>01 / ЗАМЕТКИ</span>
                <h2>Место для твоих идей.</h2>
                <p>Выбери заметку слева или создай новую. Изменения сохраняются автоматически.</p>
                <button type="button" className="secondary-button" onClick={addNote}>
                  <Plus size={16} /> Создать заметку
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
