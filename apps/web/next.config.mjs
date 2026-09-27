/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@cela/core", "@cela/llm", "@cela/sandbox", "@cela/store"],
};

export default nextConfig;
