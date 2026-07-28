/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@agent-inspector/core", "@agent-inspector/react"],
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
