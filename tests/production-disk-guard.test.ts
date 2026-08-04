import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production Docker disk guard", () => {
  const root = resolve(__dirname, "..");
  const workflow = readFileSync(resolve(root, ".github/workflows/deploy-production.yml"), "utf8");
  const cleanupScript = readFileSync(resolve(root, "scripts/cleanup-production-docker.sh"), "utf8");

  it("checks available space before Docker builds and keeps a rollback image", () => {
    expect(workflow).toContain("keep_running_image app miaomiao-points-app");
    expect(workflow).toContain("keep_running_image worker miaomiao-points-worker");
    expect(workflow).toContain("cleanup-production-docker.sh --ensure-free-gb 8");
    expect(workflow.indexOf("cleanup-production-docker.sh --ensure-free-gb 8")).toBeLessThan(
      workflow.indexOf("docker build --target runner"),
    );
  });

  it("performs conservative post-release cleanup", () => {
    expect(workflow).toContain("cleanup-production-docker.sh --retention-hours 168");
    expect(cleanupScript).toContain('protect_tag "miaomiao-points-app:production"');
    expect(cleanupScript).toContain('protect_tag "miaomiao-points-app:rollback"');
    expect(cleanupScript).toContain('protect_tag "miaomiao-points-worker:production"');
    expect(cleanupScript).toContain('protect_tag "miaomiao-points-worker:rollback"');
    expect(cleanupScript).not.toContain("Keeping recent historical image");
  });

  it("does not automate volume or all-image pruning", () => {
    expect(cleanupScript).not.toMatch(/^\s*docker volume prune/m);
    expect(cleanupScript).not.toMatch(/^\s*docker image prune -a/m);
    expect(cleanupScript).not.toMatch(/^\s*docker system prune/m);
  });
});
