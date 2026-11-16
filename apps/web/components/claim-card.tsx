"use client";

import type { ClaimWithEvidence } from "@/lib/types";
import { CLAIM_STATUS_TEXT, VERDICT_TEXT, clock, pct } from "./format";

type Props = {
  claim: ClaimWithEvidence;
  onOpen: () => void;
};

const VERDICT_PATHS: Record<string, { d: string; dot?: [number, number] }> = {
  supported: { d: "M5 12.5 9.5 17 19 7" },
  contradicted: { d: "M6.5 6.5l11 11M17.5 6.5l-11 11" },
  misleading: { d: "M12 5.5v9", dot: [12, 18.4] },
  unverifiable: { d: "M9.4 9.2a2.7 2.7 0 1 1 3.6 2.6c-.8.3-1.2 1-1.2 1.8v.4", dot: [11.8, 18.4] },
};

/**
 * Icono de esquina: tick para lo respaldado, aspa para lo contradicho.
 * Los estados que no son verdadero/falso usan una marca propia para no
 * confundirlos con un veredicto binario.
 */
export function VerdictIcon({ verdict }: { verdict: string }) {
  const icon = VERDICT_PATHS[verdict];

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icon ? <path d={icon.d} /> : <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />}
      {icon?.dot ? (
        <circle cx={icon.dot[0]} cy={icon.dot[1]} r="0.6" fill="currentColor" stroke="none" />
      ) : null}
    </svg>
  );
}

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
      <span className="claim-icon" aria-hidden="true">
        <VerdictIcon verdict={verdictClass} />
      </span>
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
          {claim.error ?? "No se pudo comprobar esta frase."}
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
              ? "Buscando quién lo ha publicado…"
              : claim.status === "evaluating"
                ? "Comparando con lo que dicen las fuentes…"
                : "En cola…"}
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
