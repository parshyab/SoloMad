// Build api/realtime images, push to ECR, and roll ECS services.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dockerAppBin = "/Applications/Docker.app/Contents/Resources/bin";
const pathEnv = process.env.PATH?.includes(dockerAppBin)
  ? process.env.PATH
  : `${dockerAppBin}:${process.env.PATH ?? ""}`;
process.env.PATH = pathEnv;
const terraformDir = join(root, "infra/terraform/environments/staging");
const terraformBin = join(root, "tools/terraform/terraform");
const aws = process.env.AWS_CLI ?? "aws";
const region = process.env.AWS_REGION ?? "us-east-1";

function output(name) {
  const parsed = JSON.parse(execFileSync(terraformBin, ["output", "-json", name], { cwd: terraformDir, encoding: "utf8" }));
  return parsed?.value ?? parsed;
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", cwd: opts.cwd ?? root, env: { ...process.env, ...opts.env } });
}

function dockerReady() {
  const candidates = [
    process.env.DOCKER,
    join(dockerAppBin, "docker"),
    "docker",
    join(root, "tools/docker-static/docker"),
  ].filter(Boolean);
  for (const bin of candidates) {
    try {
      execFileSync(bin, ["info"], { stdio: "ignore" });
      process.env.DOCKER = bin;
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

if (!dockerReady()) {
  console.log("local docker daemon unavailable; using CodeBuild");
  execFileSync("node", ["scripts/deploy-staging-ecs-codebuild.mjs"], { stdio: "inherit", cwd: root, env: process.env });
  process.exit(0);
}

const docker = process.env.DOCKER ?? "docker";
const apiRepo = output("ecr_api_repository_url");
const rtRepo = output("ecr_realtime_repository_url");
if (!apiRepo || !rtRepo) throw new Error("ECR outputs missing; apply terraform with enable_public_edge");

const account = apiRepo.split(".")[0];
const password = execFileSync(aws, ["ecr", "get-login-password", "--region", region], { encoding: "utf8" }).trim();
execFileSync(docker, ["login", "--username", "AWS", "--password-stdin", `${account}.dkr.ecr.${region}.amazonaws.com`], {
  input: password,
  encoding: "utf8",
});

for (const [service, repo] of [["api", apiRepo], ["realtime", rtRepo]]) {
  const tag = `${repo}:latest`;
  run(docker, ["build", "--platform", "linux/amd64", "-f", "infra/docker/Dockerfile", "--build-arg", `SERVICE=${service}`, "-t", tag, "."], { cwd: root });
  run(docker, ["push", tag], { cwd: root });
}

for (const service of ["solomad-staging-api", "solomad-staging-realtime"]) {
  run(aws, ["ecs", "update-service", "--cluster", "solomad-staging", "--service", service, "--force-new-deployment", "--no-cli-pager"], {
    cwd: root,
  });
}
console.log("staging ECS deployment requested");
