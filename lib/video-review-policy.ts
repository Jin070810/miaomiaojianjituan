export const SECONDARY_REVIEW_RETIRED_MESSAGE = "普通视频二次审核已停用，历史记录仅供查询；人工仅处理成员申诉";

export class SecondaryReviewRetiredError extends Error {
  constructor() {
    super(SECONDARY_REVIEW_RETIRED_MESSAGE);
    this.name = "SecondaryReviewRetiredError";
  }
}
