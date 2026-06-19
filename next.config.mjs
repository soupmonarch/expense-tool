/** @type {import('next').NextConfig} */
const nextConfig = {
  // exceljs is a server-only package; keep it external from the client bundle.
  experimental: {
    serverComponentsExternalPackages: ["exceljs", "xlsx", "jszip"],
  },
};

export default nextConfig;
