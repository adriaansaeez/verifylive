"use client";

import { useEffect } from "react";
import type { ClaimWithEvidence } from "@/lib/types";
import { CHECKABILITY_LABELS } from "@/lib/fixtures";
import { STANCE_TEXT, TIER_TEXT, VERDICT_TEXT, clock, pct, plural, quality } from "./format";

type Props = {
  claim: ClaimWithEvidence;
  onClose: () => void;
};

export default function EvidenceDrawer({ claim, onClose }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const latest = claim.revisions.at(-1) ?? null;
  const diagnostics = latest?.diagnostics ?? null;
  // The queries recorded with the verdict are the ones that actually ran; the
  // claim's own list is the fallback for a claim still being resolved.
  const queries = diagnostics?.queries?.length ? diagnostics.queries : claim.searchQueries;

  return (
    <div className="drawer-scrim" onClick={onClose} role="presentation">
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Detalle de la verificación"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <h2>Detalle de la verificación</h2>
          <button type="button" className="btn ghost small" onClick={onClose}>
            Cerrar
          </button>
        </div>
        <p className="count">
          {clock(claim.startMs)} – {clock(claim.endMs)} · {CHECKABILITY_LABELS[claim.checkability]}
        </p>

        <p className="drawer-quote">“{claim.quote || claim.text}”</p>

        {latest ? (
          <>
            <div className="drawer-section">
              <h3>Veredicto</h3>
              <div className="fact-grid">
                <div className="fact">
                  <dt>Resultado</dt>
                  <dd>
                    <span className={`chip ${latest.verdict}`}>{VERDICT_TEXT[latest.verdict]}</span>
                  </dd>
                </div>
                <div className="fact">
                  <dt>Confianza</dt>
                  <dd>{pct(latest.confidence)}</dd>
                </div>
                <div className="fact">
                  <dt>Verificabilidad</dt>
                  <dd>{pct(latest.checkableProbability)}</dd>
                </div>
                <div className="fact">
                  <dt>Calidad de evidencia</dt>
                  <dd>{quality(latest.evidenceQualityScore)}</dd>
                </div>
                <div className="fact">
                  <dt>¿Faltan fuentes?</dt>
                  <dd>{pct(latest.needsMoreSourcesProbability)}</dd>
                </div>
                <div className="fact">
                  <dt>Latencia Clef</dt>
                  <dd>{latest.clefMs === null ? "—" : `${(latest.clefMs / 1000).toFixed(1)} s`}</dd>
                </div>
              </div>
              {latest.provisional || latest.simulated ? (
                <p className="fineprint">
                  {latest.provisional ? "Veredicto provisional: evidencia o verificabilidad insuficientes. " : ""}
                  {latest.simulated ? "Generado por el evaluador simulado (sin NAN_API_KEY)." : ""}
                </p>
              ) : null}
            </div>

            <div className="drawer-section">
              <h3>Lectura</h3>
              <p className="claim-summary">{latest.summary}</p>
            </div>
          </>
        ) : (
          <div className="drawer-section">
            <h3>Estado</h3>
            <p className="claim-summary">
              {claim.error ?? "La verificación todavía está en curso para esta afirmación."}
            </p>
          </div>
        )}

        <div className="drawer-section">
          <h3>Fuentes ({claim.evidence.length})</h3>
          {claim.evidence.length === 0 ? (
            <p className="claim-summary">Sin evidencia recuperada todavía.</p>
          ) : (
            claim.evidence.map((item) => (
              <div className="source-card" key={item.id}>
                <div className="top">
                  <a href={item.url} target="_blank" rel="noreferrer noopener">
                    {item.title}
                  </a>
                </div>
                <blockquote>{item.excerpt}</blockquote>
                <div className="meta">
                  <span>{TIER_TEXT[item.sourceTier]}</span>
                  {item.stance ? <span>{STANCE_TEXT[item.stance]}</span> : null}
                  {item.publisher ? <span>{item.publisher}</span> : null}
                  {item.publishedAt ? <span>{item.publishedAt}</span> : null}
                  <span>{item.connector}</span>
                  <span>score {item.score.toFixed(2)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="drawer-section">
          <h3>Revisiones</h3>
          {claim.revisions.length === 0 ? (
            <p className="claim-summary">Todavía no hay revisiones registradas.</p>
          ) : (
            claim.revisions
              .slice()
              .reverse()
              .map((revision) => (
                <div className="revision-row" key={revision.id}>
                  <span className="n">#{revision.revision}</span>
                  <div>
                    <span className={`chip ${revision.verdict}`}>{VERDICT_TEXT[revision.verdict]}</span>
                    <p>{revision.summary}</p>
                  </div>
                  <span className="conf">
                    {pct(revision.confidence)}
                    {revision.provisional ? " · prov." : ""}
                    {revision.simulated ? " · sim." : ""}
                  </span>
                </div>
              ))
          )}
        </div>

        {queries.length > 0 ? (
          <div className="drawer-section">
            <h3>Consultas de búsqueda</h3>
            {queries.map((query) => (
              <span className="prompt-line" key={query}>
                {query}
              </span>
            ))}
          </div>
        ) : null}

        {diagnostics ? (
          <div className="drawer-section">
            <h3>Trazabilidad</h3>
            {diagnostics.connectors.length === 0 ? (
              <p className="claim-summary">No se consultó ninguna fuente externa.</p>
            ) : (
              diagnostics.connectors.map((run) => (
                <div className="probe-row" key={`${run.name}-${run.ms}`}>
                  <span className="name">{run.name}</span>
                  <span className="result">
                    {run.ok
                      ? plural(run.count, "resultado", "resultados")
                      : `error: ${run.error ?? "desconocido"}`}
                  </span>
                  <span className="time">{run.ms} ms</span>
                </div>
              ))
            )}
            <p className="fineprint">
              {diagnostics.droppedByRerank > 0
                ? `El reranker ${diagnostics.rerank === "nan" ? "semántico" : "local"} descartó ${plural(diagnostics.droppedByRerank, "fuente", "fuentes")} por no responder a la afirmación. `
                : ""}
              {diagnostics.settleable === undefined
                ? ""
                : `Acuerdo entre lectores: ${pct(diagnostics.settleable)}. `}
              {diagnostics.gate
                ? `Detección: frase terminada ${pct(diagnostics.gate.closed)}, hecho contrastable ${pct(diagnostics.gate.factual)}${diagnostics.gate.precision === undefined ? "" : `, precisión ${pct(diagnostics.gate.precision)}`}, entre ${plural(diagnostics.gate.consideredSpans, "tramo candidato", "tramos candidatos")}.`
                : "Detección heurística, sin puntuación de Clef."}
            </p>
          </div>
        ) : null}

        <p className="fineprint">
          Evidencia recuperada de {claim.evidence.length} fuente(s). Una afirmación sin fuente primaria
          nunca se presenta como concluyente.
        </p>
      </aside>
    </div>
  );
}
