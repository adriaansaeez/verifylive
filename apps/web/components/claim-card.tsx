"use client";

import type { ClaimWithEvidence } from "@/lib/types";
import { CLAIM_STATUS_TEXT, VERDICT_TEXT, clock, pct } from "./format";

type Props = {
  claim: ClaimWithEvidence;
  onOpen: () => void;
};

export default function ClaimCard({ claim, onOpen }: Props) {
  const latest = claim.revisions.at(-1) ?? null;
  const resolved = claim.status === "resolved" ? latest : null;
  const verdictClass = resolved ? resolved.verdict : "busy";
  const quote = claim.quote || claim.text;
  const showOriginal = quote.trim() !== claim.text.trim();
  const metricValue = resolved?.verdict === "unverifiable"
    ? resolved.checkableProbability
    : resolved?.confidence ?? 0;
  const metricLabel = resolved?.verdict === "unverifiable" ? "Verificabilidad" : "Confianza";

  return (
    <article className={`claim v-${verdictClass}`}>
      <div className="claim-top">
        {resolved ? (
          <span className={`chip ${resolved.verdict}`}>
            {VERDICT_TEXT[resolved.verdict]}
          </span>
        ) : (
          <span className="chip busy">
            {claim.status === "failed" ? "Sin veredicto" : CLAIM_STATUS_TEXT[claim.status]}
          </span>
        )}
        {resolved?.provisional ? <span className="chip alarm">Provisional</span> : null}
        {resolved?.simulated ? <span className="chip outline">Clef simulado</span> : null}
        {claim.checkability === "likely_opinion" ? (
          <span className="chip outline">Opinión</span>
        ) : null}
        <time>{clock(claim.startMs)}</time>
      </div>

      <p className="claim-statement">{claim.text}</p>
      {showOriginal ? (
        <p className="claim-original" title={quote}>
          <span>Cita original</span> “{quote}”
        </p>
      ) : null}

      {resolved ? (
        <p className="claim-summary">{resolved.summary}</p>
      ) : claim.status === "failed" ? (
        <p className="claim-summary">
          {claim.error ?? "No se pudo completar la verificación de esta afirmación."}
        </p>
      ) : (
        <div className="pending-block">
          <span className="pulse-dots">
            <i />
            <i />
            <i />
          </span>
          <span>
            {claim.status === "searching"
              ? "Recuperando fuentes citables…"
              : claim.status === "evaluating"
                ? "Clef está ponderando la evidencia…"
                : "En cola de verificación…"}
          </span>
        </div>
      )}

      <div className="claim-meta">
        {resolved ? (
          <span className="confidence" style={{ color: `var(--${resolved.verdict === "supported" ? "support" : resolved.verdict === "contradicted" ? "contradict" : resolved.verdict === "misleading" ? "misleading" : "unverifiable"})` }}>
            {metricLabel} {pct(metricValue)}
            <span className="confidence-track">
              <span className="confidence-fill" style={{ width: pct(metricValue) }} />
            </span>
          </span>
        ) : null}
        <span>
          {claim.evidence.length} fuente{claim.evidence.length === 1 ? "" : "s"}
        </span>
        {claim.attempts > 1 ? <span>{claim.attempts} intentos</span> : null}
        <span className="claim-actions">
          <button type="button" className="btn ghost small" onClick={onOpen}>
            Ver detalle
          </button>
        </span>
      </div>
    </article>
  );
}
