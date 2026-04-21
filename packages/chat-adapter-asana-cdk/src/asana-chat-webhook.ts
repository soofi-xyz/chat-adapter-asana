import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CustomResource, Duration, RemovalPolicy, SecretValue, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
  type IHttpApi,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret, type ISecret } from "aws-cdk-lib/aws-secretsmanager";
import { Provider } from "aws-cdk-lib/custom-resources";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Properties for the {@link AsanaChatWebhook} construct.
 *
 * The construct provisions an HTTP API endpoint that forwards Asana webhook
 * POST requests to the supplied `handler` Lambda, and registers a webhook in
 * Asana so events on the bot's "My tasks" user task list are delivered to it.
 *
 * @public
 */
export interface AsanaChatWebhookProps {
  /**
   * Lambda function that will process Asana webhook deliveries. The construct
   * wires this function up to an HTTP API route and grants it access to the
   * shared webhook signing secret (in Secrets Manager).
   *
   * The function body is expected to use `AsanaAdapter` from
   * `@soofi/chat-adapter-asana`, which reads the webhook secret from
   * Secrets Manager via the environment variable `ASANA_WEBHOOK_SECRET_ARN`.
   */
  readonly handler: LambdaFunction;

  /**
   * The Asana personal access token of the bot account. Either `accessToken`
   * or `accessTokenSecret` must be provided. If `accessToken` is used the
   * construct creates an internal Secrets Manager secret to store it.
   *
   * Avoid passing this at synth time in CI by preferring `accessTokenSecret`
   * pointing at an existing secret.
   */
  readonly accessToken?: string;

  /**
   * Existing Secrets Manager secret that stores the bot's Asana personal
   * access token. The secret value may be the raw PAT string or a JSON
   * object of the form `{ "accessToken": "<PAT>" }`.
   */
  readonly accessTokenSecret?: ISecret;

  /**
   * Asana workspace GID the bot lives in.
   */
  readonly workspaceGid: string;

  /**
   * Optional override for the resource GID the webhook is registered on.
   * If omitted the construct will resolve the bot's My-Tasks user task list
   * GID via the Asana API at deploy time.
   */
  readonly resourceGid?: string;

  /**
   * HTTP API route path that Asana will POST webhook events to.
   *
   * @default "/webhooks/asana"
   */
  readonly webhookPath?: string;

  /**
   * Log retention for the custom resource provider Lambda.
   *
   * @default RetentionDays.ONE_WEEK
   */
  readonly providerLogRetention?: RetentionDays;
}

/**
 * Provisions an HTTP API endpoint backed by the supplied handler Lambda, a
 * Secrets Manager secret for the webhook signing key, and a custom resource
 * that registers (and later deletes) an Asana webhook against the bot's
 * user-task-list resource.
 *
 * @example
 * ```ts
 * const handler = new NodejsFunction(this, "Handler", { entry: "src/handler.ts" });
 * new AsanaChatWebhook(this, "AsanaWebhook", {
 *   handler,
 *   accessToken: process.env.ASANA_PAT!,
 *   workspaceGid: process.env.ASANA_WORKSPACE_GID!,
 * });
 * ```
 *
 * @public
 */
export class AsanaChatWebhook extends Construct {
  /**
   * The HTTP API that receives Asana webhook deliveries.
   */
  public readonly httpApi: IHttpApi;

  /**
   * The Secrets Manager secret that stores the Asana webhook signing secret.
   * Populated by the handler Lambda during the initial handshake.
   */
  public readonly webhookSecret: ISecret;

  /**
   * Full URL Asana should deliver webhook events to.
   */
  public readonly webhookUrl: string;

  /**
   * GID of the Asana webhook registration (available after deployment).
   */
  public readonly webhookGid: string;

  constructor(scope: Construct, id: string, props: AsanaChatWebhookProps) {
    super(scope, id);

    if (!props.accessToken && !props.accessTokenSecret) {
      throw new Error(
        "AsanaChatWebhook requires either `accessToken` or `accessTokenSecret`.",
      );
    }

    const webhookPath = normalizePath(props.webhookPath ?? "/webhooks/asana");

    const webhookSecret = new Secret(this, "WebhookSecret", {
      description: `Asana webhook signing secret for ${Stack.of(this).stackName}/${id}`,
      secretStringValue: SecretValue.unsafePlainText(
        JSON.stringify({ secret: "" }),
      ),
    });
    webhookSecret.applyRemovalPolicy(RemovalPolicy.DESTROY);
    webhookSecret.grantRead(props.handler);
    webhookSecret.grantWrite(props.handler);

    props.handler.addEnvironment(
      "ASANA_WEBHOOK_SECRET_ARN",
      webhookSecret.secretArn,
    );
    props.handler.addEnvironment("ASANA_WORKSPACE_GID", props.workspaceGid);

    const patSecret = resolvePatSecret(this, props);
    patSecret.grantRead(props.handler);
    props.handler.addEnvironment("ASANA_PAT_SECRET_ARN", patSecret.secretArn);

    const httpApi = new HttpApi(this, "HttpApi", {
      description: `Asana webhook HTTP API (${id})`,
      corsPreflight: {
        allowMethods: [CorsHttpMethod.POST, CorsHttpMethod.GET],
        allowOrigins: ["*"],
        allowHeaders: [
          "x-hook-secret",
          "x-hook-signature",
          "content-type",
        ],
      },
    });

    httpApi.addRoutes({
      path: webhookPath,
      methods: [HttpMethod.POST, HttpMethod.GET],
      integration: new HttpLambdaIntegration("AsanaHandler", props.handler),
    });

    const webhookUrl = `${httpApi.apiEndpoint}${webhookPath}`;

    const providerLambda = new LambdaFunction(this, "ProviderHandler", {
      runtime: Runtime.NODEJS_24_X,
      handler: "provider-handler.handler",
      code: Code.fromAsset(resolveProviderAssetPath()),
      timeout: Duration.seconds(60),
      memorySize: 256,
      logRetention: props.providerLogRetention ?? RetentionDays.ONE_WEEK,
      environment: {
        ASANA_PAT_SECRET_ARN: patSecret.secretArn,
      },
    });
    patSecret.grantRead(providerLambda);

    const provider = new Provider(this, "Provider", {
      onEventHandler: providerLambda,
      logRetention: props.providerLogRetention ?? RetentionDays.ONE_WEEK,
    });

    const registration = new CustomResource(this, "Registration", {
      serviceToken: provider.serviceToken,
      resourceType: "Custom::AsanaWebhook",
      properties: {
        targetUrl: webhookUrl,
        workspaceGid: props.workspaceGid,
        ...(props.resourceGid ? { resourceGid: props.resourceGid } : {}),
      },
    });
    registration.node.addDependency(httpApi);

    this.httpApi = httpApi;
    this.webhookSecret = webhookSecret;
    this.webhookUrl = webhookUrl;
    this.webhookGid = registration.getAttString("WebhookGid");
  }
}

const normalizePath = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return `/${trimmed}`;
  }
  return trimmed;
};

const resolveProviderAssetPath = (): string => {
  const searchRoots: string[] = [];
  let current = __dirname;
  for (let i = 0; i < 8; i++) {
    searchRoots.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const root of searchRoots) {
    const candidates = [
      path.join(root, "provider"),
      path.join(root, "dist", "provider"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, "provider-handler.js"))) {
        return candidate;
      }
    }
  }
  throw new Error(
    "Unable to locate @soofi/chat-adapter-asana-cdk provider bundle (dist/provider/provider-handler.js). " +
      "Run `pnpm --filter @soofi/chat-adapter-asana-cdk build` before synth.",
  );
};

const resolvePatSecret = (
  scope: Construct,
  props: AsanaChatWebhookProps,
): ISecret => {
  if (props.accessTokenSecret) {
    return props.accessTokenSecret;
  }
  return new Secret(scope, "AccessTokenSecret", {
    description: "Asana bot personal access token",
    secretStringValue: SecretValue.unsafePlainText(
      JSON.stringify({ accessToken: props.accessToken }),
    ),
  });
};
