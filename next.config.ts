import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable server actions for real-time voice streaming
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  // Allow ElevenLabs and other external resources
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;
