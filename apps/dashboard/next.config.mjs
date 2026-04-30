/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile workspace packages so Next can consume them as TS source.
  transpilePackages: ['@a11y/shared-types'],
};

export default nextConfig;
