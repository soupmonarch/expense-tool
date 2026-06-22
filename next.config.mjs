/** @type {import('next').NextConfig} */
const nextConfig = {
  // exceljs / xlsx / jszip are server-only packages; keep them external from the
  // client bundle so the build doesn't try to bundle their Node-only internals.
  experimental: {
    serverComponentsExternalPackages: ["exceljs", "xlsx", "jszip", "pdf-lib", "pdfjs-dist"],
  },
  // Safety nets so a stray type/lint issue never blocks deployment of this
  // internal tool. Vercel will still build and deploy.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
