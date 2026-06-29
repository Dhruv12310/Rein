import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the database and AWS packages out of the bundle so they run as plain Node modules on
  // Vercel. pg and the Aurora DSQL connector open raw TCP and the AWS SDK signs IAM tokens, none
  // of which should be traced and bundled by the compiler.
  serverExternalPackages: [
    "pg",
    "pg-native",
    "@aws/aurora-dsql-node-postgres-connector",
    "@aws-sdk/dsql-signer",
    "@aws-sdk/credential-providers",
  ],
};

export default nextConfig;
