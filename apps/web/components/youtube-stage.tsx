"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { embedUrl, watchUrl, type YoutubeRef } from "@/lib/client/youtube";

type Props = {
  video: YoutubeRef;
  /** Fase de la sesión: decide si toca ofrecer empezar o informar de la captura. */
  phase: string;
  onStart: () => void;
  onChange: () => void;
};

/**
 * El vídeo suena en esta misma pestaña para que la captura lo recoja: el audio
 * de un iframe de otro origen no se puede leer desde la página, así que esta
 * es la única vía que no obliga a mandar el audio a ningún servidor.
 *
 * El iframe va marcado `credentialless` porque la página está aislada entre
 * orígenes para WebGPU; sin ese atributo el navegador lo bloquearía. Y no se
 * carga el script de la API de YouTube, que sería otra petición a otro origen
 * bajo el mismo aislamiento: las órdenes van por postMessage, que el propio
 * reproductor acepta con `enablejsapi=1`.
 */
export default function YoutubeStage({ video, phase, onStart, onChange }: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const src = useMemo(() => embedUrl(video, origin), [video, origin]);

  /**
   * `credentialless` tiene que estar puesto ANTES de que el iframe empiece a
   * cargar, o el aislamiento entre orígenes bloquea la petición y queda el
   * recuadro roto. Por eso el `src` no se pasa como propiedad de React: se
   * asigna aquí, después del atributo. Dejando que React ordenara las dos
   * cosas, el reproductor no cargaba.
   */
  const attach = useCallback(
    (el: HTMLIFrameElement | null) => {
      frameRef.current = el;
      if (!el || !src) return;
      el.setAttribute("credentialless", "");
      if (el.getAttribute("src") !== src) el.setAttribute("src", src);
    },
    [src],
  );
  const live = phase === "live";
  const starting = phase === "starting" || phase === "finishing";

  const command = (func: string) => {
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args: [] }),
      "https://www.youtube-nocookie.com",
    );
  };

  return (
    <section className="stage" aria-label="Vídeo">
      <div className="col-head">
        <span className="col-title">vídeo</span>
        <span className="stage-head-actions">
          <a className="stage-link" href={watchUrl(video)} target="_blank" rel="noopener noreferrer">
            ver en YouTube
          </a>
          <button type="button" className="btn ghost small" onClick={onChange} disabled={starting}>
            Cambiar vídeo
          </button>
        </span>
      </div>

      <div className="stage-frame">
        {origin ? (
          <iframe
            ref={attach}
            title="Vídeo que se está verificando"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : null}
      </div>

      <div className="stage-foot">
        {live ? (
          <>
            <span className="stage-transport">
              <button type="button" className="btn ghost small" onClick={() => command("playVideo")}>
                Reproducir
              </button>
              <button type="button" className="btn ghost small" onClick={() => command("pauseVideo")}>
                Pausar
              </button>
            </span>
            <p className="fineprint">Se está transcribiendo lo que suena en este reproductor.</p>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={onStart} disabled={starting}>
              {starting ? "Preparando…" : "Empezar a verificar"}
            </button>
            <p className="fineprint">
              Dale al play y busca el momento que te interese. Al empezar, Chrome pedirá compartir
              esta pestaña: acepta con <strong>«Compartir audio»</strong> marcado.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
