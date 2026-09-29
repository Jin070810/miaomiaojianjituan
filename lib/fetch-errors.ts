// 抓取层错误分类：transient 表示超时/反爬壳页/网络抖动等可重试错误，
// 交给 BullMQ 指数退避重试；permanent 表示链接无效等确定性失败，直接自动驳回。
export type VideoFetchErrorKind = "transient" | "permanent";

export class VideoFetchError extends Error {
  readonly kind: VideoFetchErrorKind;

  constructor(message: string, kind: VideoFetchErrorKind = "transient") {
    super(message);
    this.name = "VideoFetchError";
    this.kind = kind;
  }
}

export function isPermanentFetchError(error: unknown) {
  return error instanceof VideoFetchError && error.kind === "permanent";
}
