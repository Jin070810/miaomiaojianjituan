import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { miaoAssets } from "../app/member/visual-assets";

describe("成员端品牌视觉库", () => {
  it("固定提供 28 件首发资产", () => {
    const total =
      1 +
      Object.keys(miaoAssets.actions).length +
      Object.keys(miaoAssets.states).length +
      Object.keys(miaoAssets.scenes).length +
      Object.keys(miaoAssets.patterns).length;

    expect(total).toBe(28);
    expect(Object.keys(miaoAssets.actions)).toHaveLength(8);
    expect(Object.keys(miaoAssets.states)).toHaveLength(8);
    expect(Object.keys(miaoAssets.scenes)).toHaveLength(6);
    expect(Object.keys(miaoAssets.patterns)).toHaveLength(5);
  });

  it("28 件网页资产都已经落盘", () => {
    const root = path.resolve(__dirname, "..");
    const imageAssets = [
      miaoAssets.master.src,
      ...Object.values(miaoAssets.actions).map((asset) => asset.src),
      ...Object.values(miaoAssets.states).map((asset) => asset.src),
      ...Object.values(miaoAssets.scenes).map((asset) => asset.src),
      ...Object.values(miaoAssets.patterns),
    ];

    for (const asset of imageAssets) {
      expect(existsSync(path.join(root, "public", asset.replace(/^\//, ""))), asset).toBe(true);
    }
  });

  it("成员端关键页面不再显示专业化英文眉题", () => {
    const root = path.resolve(__dirname, "..");
    const source = [
      readFileSync(path.join(root, "app", "page.tsx"), "utf8"),
      readFileSync(path.join(root, "app", "login", "page.tsx"), "utf8"),
    ].join("\n");

    for (const copy of [
      "CREATOR REWARD SYSTEM",
      "CONTENT CONTRIBUTION",
      "POINTS MARKET",
      "CREATOR LEADERBOARD",
      "POINTS LEDGER",
      "TRANSFER HISTORY",
      "REDEMPTION HISTORY",
      "VIDEO CONTRIBUTION",
      "POINTS TRANSFER",
      "REDEEM GIFT",
    ]) {
      expect(source).not.toContain(copy);
    }
  });

  it("成功态按钮进入对应记录页", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "app", "page.tsx"), "utf8");

    expect(source).toContain('invalidateSections(["videos", "ledger"]); closeDialog(); handleNavigate("videos");');
    expect(source).toContain('invalidateSections(["gifts", "ledger", "orders"]); closeDialog(); handleNavigate("orders");');
  });

  it("商城提供综合、销量和价格排序入口", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "app", "page.tsx"), "utf8");

    expect(source).toContain('["featured", "综合"]');
    expect(source).toContain('["sales", "销量"]');
    expect(source).toContain('["priceAsc", "价格升序"]');
    expect(source).toContain('["priceDesc", "价格降序"]');
  });

  it("通知中心在移动端由视口遮罩居中定位", () => {
    const styles = readFileSync(path.resolve(__dirname, "..", "app", "member", "member-theme.css"), "utf8").replace(/\r/g, "");
    const panelRule = styles.slice(styles.lastIndexOf(".notification-panel {"));

    expect(panelRule).toContain("position: relative");
    expect(panelRule).toContain("align-self: center");
    expect(panelRule).toContain("margin: 0");
  });
});
