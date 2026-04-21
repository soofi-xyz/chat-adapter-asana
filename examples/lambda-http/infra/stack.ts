import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CfnOutput,
  Duration,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import type { Construct } from "constructs";
import {
  Code,
  Function as LambdaFunction,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { AsanaChatWebhook } from "@soofi-xyz/chat-adapter-asana-cdk";

export interface AsanaChatExampleStackProps extends StackProps {
  readonly accessToken: string;
  readonly workspaceGid: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Example stack that wires @soofi-xyz/chat-adapter-asana-cdk up with a Lambda
 * handler that uses @soofi-xyz/chat-adapter-asana to process Asana webhook
 * events.
 */
export class AsanaChatExampleStack extends Stack {
  public readonly handler: LambdaFunction;
  public readonly webhook: AsanaChatWebhook;

  constructor(scope: Construct, id: string, props: AsanaChatExampleStackProps) {
    super(scope, id, props);

    const handlerAssetPath = path.resolve(__dirname, "..", "dist");
    this.handler = new LambdaFunction(this, "WebhookHandler", {
      runtime: Runtime.NODEJS_24_X,
      handler: "handler.handler",
      code: Code.fromAsset(handlerAssetPath),
      timeout: Duration.seconds(30),
      memorySize: 512,
      logRetention: RetentionDays.ONE_WEEK,
      environment: {
        ASANA_WORKSPACE_GID: props.workspaceGid,
        NODE_OPTIONS: "--enable-source-maps",
      },
    });

    this.webhook = new AsanaChatWebhook(this, "AsanaWebhook", {
      handler: this.handler,
      accessToken: props.accessToken,
      workspaceGid: props.workspaceGid,
    });

    new CfnOutput(this, "WebhookUrl", {
      value: this.webhook.webhookUrl,
      description: "Asana webhook target URL",
    });
    new CfnOutput(this, "WebhookGid", {
      value: this.webhook.webhookGid,
      description: "Asana webhook registration GID",
    });
    new CfnOutput(this, "WebhookSecretArn", {
      value: this.webhook.webhookSecret.secretArn,
      description: "Secrets Manager secret ARN for the webhook signing key",
    });
  }
}
