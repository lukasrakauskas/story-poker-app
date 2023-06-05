/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  transpilePackages: ["ui"],
  experimental: {
    // TODO: remove after this issue is fixed https://github.com/airbnb/visx/issues/1637
    esmExternals: "loose",
  },
  env: {
    PROJECT_ROOT: __dirname,
  },
};
