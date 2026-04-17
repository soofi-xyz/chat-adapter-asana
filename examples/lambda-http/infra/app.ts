#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { AsanaChatExampleStack } from "./stack";

const app = new App();

const accessToken = process.env.ASANA_PAT ?? process.env.ASANA_ACCESS_TOKEN;
const workspaceGid = process.env.ASANA_WORKSPACE_GID;

if (!accessToken) {
  throw new Error("Set ASANA_PAT (bot personal access token) before deploy.");
}
if (!workspaceGid) {
  throw new Error("Set ASANA_WORKSPACE_GID before deploy.");
}

new AsanaChatExampleStack(app, "AsanaChatAdapterExample", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  accessToken,
  workspaceGid,
});
