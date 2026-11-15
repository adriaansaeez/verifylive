"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/lib/client/use-session";
import { clock } from "./format";
import ClaimCard from "./claim-card";
import EvidenceDrawer from "./evidence-drawer";

const PHASE_LABEL: Record<string, string> = {
  setup: "En espera",
  starting: "Iniciando",
  live: "En directo",
  finishing: "Cerrando",
  done: "Sesión cerrada",
  error: "Error",
};

export default function VeritasApp() {
  const session = useSession();
  const [openClaimId, setOpenClaimId] = useState<string | null>(null);
  const { snapshot, config, phase } = session;

  const claims = useMemo(() => (snapshot ? [...snapshot.claims].reverse() : []), [snapshot]);
  const segments = snapshot?.segments ?? [];
  const claimForSegment = (startMs: number, endMs: number) =>
    snapshot?.claims.find((claim) => claim.startMs < endMs && claim.endMs > startMs) ?? null;
  const openClaim = claims.find((claim) => claim.id === openClaimId) ?? null;
  const inProgress = phase === "starting" || phase === "live" || phase === "finishing";
  const resolvedCount = claims.filter((claim) => claim.status === "resolved").length;
  const failedClaims = claims.filter((claim) => claim.status === "failed").length;

  return (
    <div className="shell">
      <header className="masthead">
        <div className="wordmark">
          <strong>Veritas</strong>
          <span>Live</span>
        </div>
        {config ? (
          <span className={`mode-chip ${config.clefMode === "live" ? "live" : ""}`}>
            <i className="dot" />
            {config.clefMode === "live" ? "clef en vivo" : "clef simulado"}
          </span>
        ) : null}
        <span className="mode-chip">
          <i className="dot" />
          {PHASE_LABEL[phase] ?? phase}
        </span>
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
          <button type="button" className="btn ghost small" onClick={session.reset}>
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

      {phase === "setup" || phase === "error" ? (
        <Setup session={session} />
      ) : (
        <main className="live">
          <section className="transcript-col" aria-label="Transcripción">
            <div className="col-head">
              <span className="col-title">Transcripción</span>
              {session.source === "tab" ? (
                <div className="meter" title="Nivel de audio de la pestaña">
                  <span className="col-title">{session.asrBusy ? "asr" : "audio"}</span>
                  <span className="meter-track">
                    <span
                      className="meter-fill"
                      style={{ width: `${Math.round(Math.max(session.level, 0.04) * 100)}%` }}
                    />
                  </span>
                </div>
              ) : (
                <span className="col-title">guion · {clock(session.demoInfo?.durationMs ?? 0)}</span>
              )}
            </div>
            {segments.length === 0 ? (
              <p className="transcript-empty">
                {phase === "starting"
                  ? session.model.message || "Preparando la captura…"
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

          <section className="claims-col" aria-label="Afirmaciones analizadas">
            <div className="claims-head">
              <h2>Afirmaciones</h2>
              <span className="count">
                {resolvedCount}/{claims.length} analizadas
              </span>
            </div>
            <p className="claims-sub">
              Cada frase factual se contrasta con fuentes citables y se pondera con Clef. Sin evidencia
              suficiente no hay veredicto concluyente: la confianza se rebaja y el resultado se marca como
              provisional.
            </p>

            <div className="queue-strip">
              <span>
                clef <strong>{snapshot?.queue.inFlight ?? 0}</strong> en curso
              </span>
              <span>
                cola <strong>{snapshot?.queue.waiting ?? 0}</strong>
              </span>
              <span>
                resueltas <strong>{resolvedCount}</strong>
              </span>
              <span>
                fallidas <strong>{failedClaims}</strong>
              </span>
              <span>
                última espera{" "}
                <strong>
                  {snapshot?.queue.lastWaitMs ? `${(snapshot.queue.lastWaitMs / 1000).toFixed(1)} s` : "—"}
                </strong>
              </span>
            </div>

            {claims.length === 0 ? (
              <div className="empty-state">
                <strong>Sin afirmaciones todavía</strong>
                Las frases verificables aparecerán aquí en cuanto lleguen con suficiente contexto.
              </div>
            ) : (
              <div className="claim-list">
                {claims.map((claim) => (
                  <ClaimCard key={claim.id} claim={claim} onOpen={() => setOpenClaimId(claim.id)} />
                ))}
              </div>
            )}

            {phase === "done" ? (
              <p className="fineprint">
                Sesión cerrada. {resolvedCount} de {claims.length} afirmaciones quedaron analizadas; el resto
                sigue visible con su estado real, no se rellena con una respuesta inventada.
              </p>
            ) : null}
          </section>
        </main>
      )}

      {openClaim ? <EvidenceDrawer claim={openClaim} onClose={() => setOpenClaimId(null)} /> : null}
    </div>
  );
}

type SetupProps = {
  session: ReturnType<typeof useSession>;
};

function Setup({ session }: SetupProps) {
  const { config, phase, model, demoInfo } = session;
  const busy = phase === "starting";
  const [accessToken, setAccessToken] = useState("");
  const [accessStatus, setAccessStatus] = useState<string | null>(null);

  const saveAccess = async (): Promise<void> => {
    setAccessStatus("Comprobando…");
    const response = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: accessToken }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setAccessStatus(payload.error ?? `HTTP ${response.status}`);
      return;
    }
    setAccessToken("");
    setAccessStatus("Acceso guardado para esta sesión del navegador.");
  };

  return (
    <section className="setup">
      <div className="setup-card">
        <div>
          <p className="kicker">Verificación en directo</p>
          <h1>
            Lo que se dice <em>en pantalla</em>, contrastado mientras se dice.
          </h1>
          <p className="lede">
            Veritas Live escucha el audio de una pestaña, transcribe en local y convierte cada afirmación
            factual en una tarjeta con fuentes citables, nivel de confianza y aviso cuando la evidencia no
            alcanza.
          </p>
          <ul className="principle-list">
            <li>Audio e inferencia local: el modelo se descarga una vez y corre en tu máquina.</li>
            <li>Cola secuencial para Clef: una llamada cada vez, con reintentos y timeout de 50 s.</li>
            <li>La política de veredicto nunca deja que el modelo tenga la última palabra.</li>
            <li>Todo el flujo funciona sin claves, con un evaluador simulado honesto.</li>
          </ul>
          <div className="setup-actions">
            <button
              type="button"
              className="btn"
              onClick={() => void session.startDemo()}
              disabled={busy || !config}
            >
              {busy ? "Preparando…" : `Ver demo guionizada (${demoInfo ? clock(demoInfo.durationMs) : "90 s"})`}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void session.startTab()}
              disabled={busy || !config}
            >
              Compartir audio de una pestaña
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void session.startMic()}
              disabled={busy || !config}
            >
              Usar micrófono
            </button>
          </div>
          <form
            className="setup-actions"
            onSubmit={(event) => {
              event.preventDefault();
              void saveAccess();
            }}
          >
            <input
              type="password"
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
              placeholder="Token de demo pública (si se requiere)"
              aria-label="Token de acceso a la demo"
              autoComplete="current-password"
            />
            <button type="submit" className="btn ghost" disabled={!accessToken || busy}>
              Guardar acceso
            </button>
          </form>
          {accessStatus ? <p className="setup-note">{accessStatus}</p> : null}
          <p className="setup-note">
            {busy
              ? `${model.message || "Iniciando captura"}${model.stage === "loading" ? ` · ${Math.round(model.progress * 100)}%` : ""}`
              : "Comparte una pestaña (no una ventana) y marca «Compartir audio». Sin esa casilla, pon el audio alto y usa el micrófono."}
          </p>
        </div>

        <div className="panel checklist">
          <h2>Preparación del entorno</h2>
          {config ? (
            <dl>
              <div className="check-row">
                <dt>Evaluador Clef</dt>
                <dd className={config.clefMode === "live" ? "ok" : "warn"}>
                  {config.clefMode === "live" ? "NAN conectado" : "simulado"}
                </dd>
              </div>
              <div className="check-row">
                <dt>Extractor de afirmaciones</dt>
                <dd className={config.chatExtractor ? "ok" : "off"}>
                  {config.chatExtractor ? "chat NAN" : "heurístico local"}
                </dd>
              </div>
              <div className="check-row">
                <dt>Reordenación de evidencia</dt>
                <dd className={config.rerank === "nan" ? "ok" : "off"}>
                  {config.rerank === "nan" ? "NAN" : "local"}
                </dd>
              </div>
              <div className="check-row">
                <dt>Wikipedia</dt>
                <dd className={config.wikipedia ? "ok" : "off"}>
                  {config.wikipedia ? "activa" : "desactivada"}
                </dd>
              </div>
              <div className="check-row">
                <dt>Buscador web</dt>
                <dd className={config.search ? "ok" : "off"}>
                  {config.search ? config.search : "desactivado"}
                </dd>
              </div>
              <div className="check-row">
                <dt>Lectura de fuentes (Jina)</dt>
                <dd className={config.jina ? "ok" : "off"}>{config.jina ? "activa" : "solo extractos"}</dd>
              </div>
              <div className="check-row">
                <dt>Búsqueda web en la nube</dt>
                <dd className={config.cloudEvidence ? "ok" : "off"}>
                  {config.cloudEvidence ? "activa" : "local"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="claim-summary">Leyendo configuración…</p>
          )}
          <p className="foot">
            Las claves se leen del entorno del servidor. Sin <code>NAN_KEY</code> el veredicto se
            calcula con el evaluador simulado y se etiqueta como tal en cada tarjeta: nunca se presenta
            como una respuesta real.
          </p>
        </div>
      </div>
    </section>
  );
}
