/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@cela/core", "@cela/llm", "@cela/sandbox", "@cela/store"],
  experimental: {
    // Windows: avoid worker-process spawn failures (spawn UNKNOWN) during
    // static generation by running it in-process.
    workerThreads: false,
    cpus: 1,
  },
};

export default nextConfig;
