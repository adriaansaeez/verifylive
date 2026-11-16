"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { embedUrl, type YoutubeRef } from "@/lib/client/youtube";

type Props = {
  video: YoutubeRef;
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
export default function YoutubeStage({ video }: Props) {
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
      if (!el || !src) return;
      el.setAttribute("credentialless", "");
      if (el.getAttribute("src") !== src) el.setAttribute("src", src);
    },
    [src],
  );

  return (
    <section className="stage" aria-label="Vídeo">
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
    </section>
  );
}
