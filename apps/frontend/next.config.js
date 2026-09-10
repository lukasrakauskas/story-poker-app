/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  transpilePackages: ["ui"],
  env: {
    PROJECT_ROOT: __dirname,
  },
};
