/** @type {import('next').NextConfig} */
const nextConfig = {
  // ccxt ships bundled crypto deps that webpack can't resolve; load it at
  // runtime on the server instead of bundling it.
  experimental: {
    serverComponentsExternalPackages: ["ccxt", "@resvg/resvg-js"],
  },
};
export default nextConfig;
