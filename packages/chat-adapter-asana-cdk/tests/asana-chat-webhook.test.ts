import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import {
  Code,
  Function as LambdaFunction,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { describe, expect, test } from "vitest";
import { AsanaChatWebhook } from "../src/asana-chat-webhook";

const buildStack = (): { stack: Stack; handler: LambdaFunction } => {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const handler = new LambdaFunction(stack, "Handler", {
    runtime: Runtime.NODEJS_20_X,
    handler: "index.handler",
    code: Code.fromInline("exports.handler = async () => ({ statusCode: 200 });"),
  });
  return { stack, handler };
};

describe("AsanaChatWebhook", () => {
  test("provisions HTTP API, route, custom resource, and secrets", () => {
    const { stack, handler } = buildStack();
    new AsanaChatWebhook(stack, "Webhook", {
      handler,
      accessToken: "pat-test",
      workspaceGid: "11111",
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /webhooks/asana",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /webhooks/asana",
    });
    template.resourceCountIs("Custom::AsanaWebhook", 1);
    template.resourceCountIs("AWS::SecretsManager::Secret", 2);
    template.hasResourceProperties("Custom::AsanaWebhook", {
      workspaceGid: "11111",
    });
  });

  test("accepts a custom webhookPath and existing PAT secret", () => {
    const { stack, handler } = buildStack();
    const patSecret = new Secret(stack, "Pat", {
      secretName: "asana-pat",
    });
    new AsanaChatWebhook(stack, "Webhook", {
      handler,
      accessTokenSecret: patSecret,
      workspaceGid: "22222",
      webhookPath: "asana-hook",
      resourceGid: "99999",
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /asana-hook",
    });
    template.hasResourceProperties("Custom::AsanaWebhook", {
      workspaceGid: "22222",
      resourceGid: "99999",
    });
    template.resourceCountIs("AWS::SecretsManager::Secret", 2);
  });

  test("throws when neither token nor secret provided", () => {
    const { stack, handler } = buildStack();
    expect(() =>
      new AsanaChatWebhook(stack, "Webhook", {
        handler,
        workspaceGid: "33333",
      } as unknown as Parameters<typeof AsanaChatWebhook>[2]),
    ).toThrow(/accessToken/i);
  });
});
