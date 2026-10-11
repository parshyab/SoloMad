import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const terraformDir = join(root, "infra/terraform/environments/staging");
const terraformBin = join(root, "tools/terraform/terraform");
const aws = process.env.AWS_CLI ?? "aws";
const region = process.env.AWS_REGION ?? "us-east-1";

function output(name) {
  const parsed = JSON.parse(execFileSync(terraformBin, ["output", "-json", name], { cwd: terraformDir, encoding: "utf8" }));
  return parsed?.value ?? parsed;
}

let project;
try {
  project = output("codebuild_project_name");
} catch {
  project = "solomad-staging-images";
}
const mediaBucket = output("media_bucket");
if (!project || !mediaBucket) throw new Error("codebuild project or media bucket missing; run terraform apply");

const archivePath = join(root, "tmp/staging-codebuild-source.tgz");
mkdirSync(join(root, "tmp"), { recursive: true });
execFileSync(
  "tar",
  [
    "-czf",
    archivePath,
    "--exclude=node_modules",
    "--exclude=.git",
    "--exclude=tools/aws-cli",
    "--exclude=tools/colima",
    "--exclude=tools/lima",
    "--exclude=tools/docker-static",
    "--exclude=infra/terraform",
    "--exclude=tmp",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "packages",
    "apps",
    "infra/docker",
    "infra/codebuild",
  ],
  { cwd: root, stdio: "inherit" },
);

const s3Key = "codebuild/source.tgz";
execFileSync(aws, ["s3", "cp", archivePath, `s3://${mediaBucket}/${s3Key}`, "--region", region, "--no-cli-pager"], {
  stdio: "inherit",
});

let start;
try {
  start = JSON.parse(
    execFileSync(
      aws,
      [
        "codebuild",
        "start-build",
      "--project-name",
      project,
      "--source-type-override",
      "S3",
      "--source-location-override",
      `${mediaBucket}/${s3Key}`,
      "--region",
      region,
      "--no-cli-pager",
      "--output",
      "json",
    ],
      { encoding: "utf8" },
    ),
  );
} catch (error) {
  const message = String(error.stderr ?? error.message ?? error);
  if (message.includes("AccountLimitExceededException") || message.includes("Cannot have more than 0 builds")) {
    console.error("CodeBuild is not available on this AWS account (Free Tier limit). Install Docker Desktop and rerun make staging-deploy-ecs.");
    process.exit(1);
  }
  throw error;
}
const buildId = start.build.id;
console.log(`codebuild started: ${buildId}`);

for (let attempt = 0; attempt < 120; attempt += 1) {
  const status = JSON.parse(
    execFileSync(aws, ["codebuild", "batch-get-builds", "--ids", buildId, "--region", region, "--no-cli-pager", "--output", "json"], {
      encoding: "utf8",
    }),
  ).builds[0];
  console.log(`codebuild status: ${status.buildStatus}`);
  if (status.buildStatus === "SUCCEEDED") process.exit(0);
  if (["FAILED", "FAULT", "STOPPED", "TIMED_OUT"].includes(status.buildStatus)) process.exit(1);
  execFileSync("sleep", ["15"]);
}
console.error("codebuild timed out waiting for completion");
process.exit(1);
