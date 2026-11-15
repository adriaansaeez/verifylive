import type { NextConfig } from "next";

/**
 * COOP/COEP son necesarios para WebGPU + SharedArrayBuffer dentro de ONNX
 * Runtime Web. Toda petición a otro origen debe llevar CORS o CORP; el CDN del
 * modelo y los conectores de evidencia ya van sin credenciales.
 *
 * `credentialless` en lugar de `require-corp`: ambos aíslan el origen, así que
 * SharedArrayBuffer se mantiene, pero `require-corp` exige que el recurso
 * incrustado mande su propia cabecera y el reproductor de YouTube no lo hace.
 * Con `credentialless` y un iframe marcado como tal, el vídeo puede sonar en
 * esta misma pestaña, que es de donde la captura toma el audio.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: ["browser-whisper"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
