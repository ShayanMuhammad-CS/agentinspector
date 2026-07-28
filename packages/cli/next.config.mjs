/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ["js", "jsx"],
  transpilePackages: ["@kashifmuhammad/agent-inspector-core", "@kashifmuhammad/agent-inspector-react"],
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;

