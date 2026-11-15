import type { NextConfig } from "next";

/**
 * COOP/COEP are required for WebGPU + SharedArrayBuffer inside ONNX Runtime Web.
 * Every cross-origin request made by the app must be CORS-enabled or carry CORP;
 * the model CDN and the evidence connectors both use credentialed-free CORS fetches.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: ["browser-whisper"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
