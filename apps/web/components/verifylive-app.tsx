"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/client/use-session";
import { clock } from "./format";
import type { Verdict } from "@/lib/types";
import ClaimCard, { VerdictIcon } from "./claim-card";
import EvidenceDrawer from "./evidence-drawer";
import JudgeMark from "./judge-mark";
import YoutubeStage from "./youtube-stage";
import { parseYoutube, type YoutubeRef } from "@/lib/client/youtube";

const VERDICT_ORDER: Verdict[] = ["supported", "contradicted", "misleading", "unverifiable"];

const VERDICT_PLURAL: Record<Verdict, string> = {
  supported: "Respaldadas",
  contradicted: "Contradichas",
  misleading: "Engañosas",
  unverifiable: "No verificables",
};

export default function VerifyLiveApp() {
  const session = useSession();
  const [openClaimId, setOpenClaimId] = useState<string | null>(null);
  const [video, setVideo] = useState<YoutubeRef | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<Verdict | null>(null);
  const { snapshot, phase } = session;

  /**
   * La transcripción sigue siempre la última palabra, salvo que el usuario
   * suba a leer algo: en cuanto se aleja del fondo dejamos de arrastrarle.
   */
  const transcriptEl = useRef<HTMLElement | null>(null);
  const followTail = useRef(true);

  const attachTranscript = useCallback((el: HTMLElement | null) => {
    transcriptEl.current = el;
    if (!el) return;

    followTail.current = true;
    const nearBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    const onScroll = () => {
      followTail.current = nearBottom();
    };
    // La intención del usuario manda: si empuja hacia arriba dejamos de
    // perseguir la última frase aunque llegue un segmento en ese instante.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) followTail.current = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) followTail.current = false;
    };
    const onTouchStart = () => {
      if (!nearBottom()) followTail.current = false;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const claims = useMemo(() => (snapshot ? [...snapshot.claims].reverse() : []), [snapshot]);
  const segments = snapshot?.segments ?? [];

  useEffect(() => {
    const el = transcriptEl.current;
    if (!el || !followTail.current) return;
    if (el.scrollHeight > el.clientHeight + 1) {
      el.scrollTop = el.scrollHeight;
    } else {
      // En móvil la columna no tiene scroll propio: la página es la que crece.
      window.scrollTo(0, document.documentElement.scrollHeight);
    }
  }, [segments, phase]);

  const verdictCounts = useMemo(() => {
    const counts: Record<Verdict, number> = { supported: 0, contradicted: 0, misleading: 0, unverifiable: 0 };
    for (const claim of snapshot?.claims ?? []) {
      if (claim.status !== "resolved") continue;
      const verdict = claim.revisions.at(-1)?.verdict;
      if (verdict) counts[verdict] += 1;
    }
    return counts;
  }, [snapshot]);
  const claimForSegment = (startMs: number, endMs: number) =>
    snapshot?.claims.find((claim) => claim.startMs < endMs && claim.endMs > startMs) ?? null;
  const openClaim = claims.find((claim) => claim.id === openClaimId) ?? null;
  const inProgress = phase === "starting" || phase === "live" || phase === "finishing";
  const resolvedCount = claims.filter((claim) => claim.status === "resolved").length;
  const failedClaims = claims.filter((claim) => claim.status === "failed").length;
  const visibleClaims = useMemo(
    () =>
      verdictFilter
        ? claims.filter(
            (claim) =>
              claim.status === "resolved" && claim.revisions.at(-1)?.verdict === verdictFilter,
          )
        : claims,
    [claims, verdictFilter],
  );

  // Un filtro no debe sobrevivir a la sesión que lo justificaba.
  useEffect(() => {
    if (claims.length === 0) setVerdictFilter(null);
  }, [claims.length]);

  return (
    <div className="shell">
      <header className="masthead">
        <div className="wordmark">
          <JudgeMark className="wordmark-mark" />
          <strong>VerifyLive</strong>
          <span>Live</span>
        </div>
        <a
          className="masthead-repo"
          href="https://github.com/adriaansaeez/verifylive"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          Repositorio
        </a>
        <span className="masthead-spacer" />
        {inProgress ? (
          <button
            type="button"
            className="btn danger small"
            onClick={() => void session.stop()}
            disabled={phase === "starting" || phase === "finishing"}
          >
            {phase === "finishing" ? "Cerrando…" : phase === "starting" ? "Preparando…" : "Detener y verificar"}
          </button>
        ) : (
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              setVideo(null);
              session.reset();
            }}
          >
            Nueva sesión
          </button>
        )}
      </header>

      {session.error ? (
        <div className="error-banner">
          <span>{session.error}</span>
          <button type="button" className="btn ghost small" onClick={session.reset}>
            Descartar
          </button>
        </div>
      ) : null}

      {(phase === "setup" || phase === "error") && !video ? (
        <Setup session={session} onVideo={setVideo} />
      ) : (
        <main className={`live${video ? " with-stage" : ""}`}>
          <div className="stage-col">
            {video ? <YoutubeStage video={video} /> : null}
            <section className="transcript-col" aria-label="Transcripción" ref={attachTranscript}>
            <div className="col-head">
              <span className="col-title">Transcripción</span>
              {session.source === "tab" && inProgress ? (
                <div className="meter" title="Nivel de audio de la pestaña">
                  <span className="col-title">{session.asrBusy ? "asr" : "audio"}</span>
                  <span className="meter-track">
                    <span
                      className="meter-fill"
                      style={{ width: `${Math.round(Math.max(session.level, 0.04) * 100)}%` }}
                    />
                  </span>
                </div>
              ) : session.source === "fixture" ? (
                <span className="col-title">guion · {clock(session.demoInfo?.durationMs ?? 0)}</span>
              ) : null}
            </div>
            {segments.length === 0 ? (
              <p className="transcript-empty">
                {phase === "starting"
                  ? session.model.message || "Preparando la captura…"
                  : phase === "setup" || phase === "error"
                    ? "Pulsa «Empezar a verificar» cuando el vídeo esté donde quieras."
                    : "Esperando la primera frase…"}
              </p>
            ) : (
              <div className="transcript-document" aria-live="polite">
                {segments.map((segment, index) => {
                  const matched = claimForSegment(segment.startMs, segment.endMs);
                  return (
                    <span className="transcript-run" key={segment.id}>
                      {(index === 0 || segment.startMs - segments[index - 1]!.startMs >= 20_000) ? (
                        <time>{clock(segment.startMs)}</time>
                      ) : null}
                      {matched ? (
                        <button
                          type="button"
                          className={`claim-highlight status-${matched.status}`}
                          onClick={() => setOpenClaimId(matched.id)}
                          title="Abrir verificación de esta afirmación"
                        >
                          {segment.text}
                        </button>
                      ) : (
                        <span className={index === segments.length - 1 ? "fresh" : ""}>{segment.text}</span>
                      )}{" "}
                    </span>
                  );
                })}
                {phase === "live" ? <span className="writing-caret" aria-hidden="true" /> : null}
              </div>
            )}
            {phase === "starting" && session.model.stage === "loading" ? (
              <p className="fineprint">
                {session.model.message} · {Math.round(session.model.progress * 100)}%
              </p>
            ) : null}
            </section>
          </div>

          <section className="claims-col" aria-label="Afirmaciones analizadas">
            <div className="claims-head">
              <h2>Afirmaciones</h2>
              <span className="count">
                {resolvedCount}/{claims.length} analizadas
              </span>
            </div>
            {claims.length > 0 ? (
              <>
                <div className="claims-summary">
                  <span>
                    Resueltas <strong>{resolvedCount}</strong>
                  </span>
                  <span className="claims-summary-divider" aria-hidden="true" />
                  <span>
                    Fallidas <strong>{failedClaims}</strong>
                  </span>
                </div>
                <div
                  className="verdict-strip"
                  role="group"
                  aria-label="Clasificar afirmaciones por veredicto"
                >
                  <button
                    type="button"
                    className={`verdict-pill all${verdictFilter === null ? " active" : ""}`}
                    aria-pressed={verdictFilter === null}
                    onClick={() => setVerdictFilter(null)}
                  >
                    Todas <span>{claims.length}</span>
                  </button>
                  {VERDICT_ORDER.map((verdict) => (
                    <button
                      key={verdict}
                      type="button"
                      data-count={verdictCounts[verdict]}
                      className={`verdict-pill ${verdict}${verdictFilter === verdict ? " active" : ""}`}
                      aria-pressed={verdictFilter === verdict}
                      onClick={() =>
                        setVerdictFilter((current) => (current === verdict ? null : verdict))
                      }
                    >
                      <VerdictIcon verdict={verdict} />
                      {VERDICT_PLURAL[verdict]} <span>{verdictCounts[verdict]}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {claims.length === 0 ? (
              phase === "setup" || phase === "error" ? (
                <div className="empty-state">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void session.startTab({ preferCurrentTab: true })}
                  >
                    Empezar a verificar
                  </button>
                </div>
              ) : phase === "starting" || phase === "finishing" ? (
                <div className="empty-state">
                  <button type="button" className="btn" disabled>
                    {phase === "finishing" ? "Cerrando…" : "Preparando…"}
                  </button>
                </div>
              ) : null
            ) : visibleClaims.length === 0 ? (
              <p className="claims-filter-empty">
                No hay afirmaciones de este tipo todavía.
              </p>
            ) : (
              <div className="claim-list">
                {visibleClaims.map((claim) => (
                  <ClaimCard key={claim.id} claim={claim} onOpen={() => setOpenClaimId(claim.id)} />
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      {openClaim ? <EvidenceDrawer claim={openClaim} onClose={() => setOpenClaimId(null)} /> : null}
    </div>
  );
}

type SetupProps = {
  session: ReturnType<typeof useSession>;
  onVideo: (video: YoutubeRef) => void;
};

function Setup({ session, onVideo }: SetupProps) {
  const { config, phase, model } = session;
  const busy = phase === "starting";
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  // Solo carga el vídeo. La captura va aparte, desde el propio panel, para
  // que el usuario pueda situarse en el minuto que le interese antes.
  const startVideo = (event: React.FormEvent): void => {
    event.preventDefault();
    const parsed = parseYoutube(url);
    if (!parsed) {
      setUrlError("No reconozco ese enlace. Pega la dirección de un vídeo de YouTube.");
      return;
    }
    setUrlError(null);
    onVideo(parsed);
  };

  return (
    <section className="setup">
      <div className="setup-card">
        <div>
          <p className="kicker">Verificación en directo</p>
          <h1>
            Que no te la <em>cuelen</em>.
          </h1>
          <p className="lede">
            Pon un debate, un mitin o una entrevista. VerifyLive escucha, se queda con lo que de verdad se
            puede comprobar y te enseña, mientras hablan, qué fuentes lo respaldan o lo desmienten. Con el
            enlace, para que lo mires tú.
          </p>
          <ul className="principle-list">
            <li>Cuando no hay con qué comprobarlo, lo dice. No rellena huecos.</li>
            <li>Distingue un dato de una opinión: «la sanidad va a peor» no entra.</li>
            <li>Cada veredicto lleva debajo las fuentes con las que se tomó.</li>
            <li>El audio no sale de tu ordenador: se transcribe aquí mismo.</li>
          </ul>
          <form className="video-form" onSubmit={startVideo}>
            <label className="video-label" htmlFor="yt-url">
              Pega el enlace del vídeo, el debate o el mitin
            </label>
            <div className="video-row">
              <input
                id="yt-url"
                type="url"
                inputMode="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  if (urlError) setUrlError(null);
                }}
                disabled={busy || !config}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="btn" disabled={busy || !config || !url.trim()}>
                Cargar vídeo
              </button>
            </div>
            <p className="setup-note">
              {urlError ?? "El vídeo se abre aquí dentro, junto a la transcripción y las verificaciones."}
            </p>
          </form>

          <div className="setup-paths">
            <span className="setup-paths-label">o captura el audio</span>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => void session.startTab()}
              disabled={busy || !config}
            >
              Compartir pestaña
            </button>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => void session.startMic()}
              disabled={busy || !config}
            >
              Usar micrófono
            </button>
          </div>
          <p className="setup-note">
            {busy
              ? `${model.message || "Iniciando captura"}${model.stage === "loading" ? ` · ${Math.round(model.progress * 100)}%` : ""}`
              : "Para la pestaña elige el vídeo, no la ventana entera, y marca «Compartir audio»; si no aparece la casilla, usa el micrófono."}
          </p>
          <a
            className="nan-badge"
            href="https://nan.builders/?ref=built-with-nan"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://nan.builders/badge/built-with-nan-light.svg"
              alt="Built with NaN"
              width={266}
              height={104}
            />
          </a>
        </div>

      </div>
    </section>
  );
}
