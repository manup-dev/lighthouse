/** @type {import('next').NextConfig} */
const API_ORIGIN =
  process.env.LIGHTHOUSE_API_ORIGIN || "http://127.0.0.1:8787";

const nextConfig = {
  // Proxy /api/* from the Next.js host to the local FastAPI process.
  // This way the public cloudflared tunnel only needs to expose port 3737;
  // the API (8787) stays bound to loopback and can't be hit directly from
  // the internet. The frontend calls are same-origin, which also sidesteps
  // CORS complexity once the app runs behind a public hostname.
  async rewrites() {
    // Use `beforeFiles` so this wins over Next's filesystem router — in App
    // Router, `/api/health` would otherwise fall through to the 404 page.
    return {
      beforeFiles: [
        { source: "/api/:path*", destination: `${API_ORIGIN}/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
