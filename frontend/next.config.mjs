/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    const backend = process.env.BACKEND_INTERNAL_URL || "http://backend:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`
      },
      {
        source: "/downloads/:path*",
        destination: `${backend}/downloads/:path*`
      }
    ];
  }
};

export default nextConfig;

