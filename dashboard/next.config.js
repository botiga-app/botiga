/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai'
  },
  experimental: {
    serverComponentsExternalPackages: []
  }
};

module.exports = nextConfig;
