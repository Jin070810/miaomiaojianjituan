export const miaoAssets = {
  v3: {
    emblem: "/brand/miaomiao/v3/brand-emblem.webp",
    paper: "/brand/miaomiao/v3/paper-texture.webp",
    scrapbook: "/brand/miaomiao/v3/scrapbook-corner.webp",
    heroSwoosh: "/brand/miaomiao/v3/hero-swoosh.webp",
    concert: "/brand/miaomiao/v3/concert-highlight.webp",
    characters: {
      home: "/brand/miaomiao/v3/character-home.webp",
      welcome: "/brand/miaomiao/v3/character-welcome.webp",
      videos: "/brand/miaomiao/v3/character-videos.webp",
      gift: "/brand/miaomiao/v3/character-gift.webp",
      award: "/brand/miaomiao/v3/character-award.webp",
    },
  },
  master: {
    src: "/brand/miaomiao/characters/miao-master.webp",
    alt: "妙妙穿着莓紫色直播舞台装，开心地向剪辑团成员打招呼",
  },
  actions: {
    welcome: {
      src: "/brand/miaomiao/characters/action-welcome.webp",
      alt: "妙妙挥手欢迎",
    },
    live: {
      src: "/brand/miaomiao/characters/action-live.webp",
      alt: "妙妙准备开始直播",
    },
    highlight: {
      src: "/brand/miaomiao/characters/action-highlight.webp",
      alt: "妙妙发现直播高光片段",
    },
    like: {
      src: "/brand/miaomiao/characters/action-like.webp",
      alt: "妙妙为精彩切片点赞",
    },
    wait: {
      src: "/brand/miaomiao/characters/action-wait.webp",
      alt: "妙妙耐心等待",
    },
    cheer: {
      src: "/brand/miaomiao/characters/action-cheer.webp",
      alt: "妙妙为剪辑团成员加油",
    },
    award: {
      src: "/brand/miaomiao/characters/action-award.webp",
      alt: "妙妙举起奖杯庆祝",
    },
    gift: {
      src: "/brand/miaomiao/characters/action-gift.webp",
      alt: "妙妙送出礼物",
    },
  },
  states: {
    first: {
      src: "/brand/miaomiao/states/state-first.webp",
      alt: "妙妙邀请你提交第一条直播切片",
    },
    checking: {
      src: "/brand/miaomiao/states/state-checking.webp",
      alt: "妙妙正在检查视频",
    },
    rejected: {
      src: "/brand/miaomiao/states/state-rejected.webp",
      alt: "妙妙提示这条视频需要再看看",
    },
    appeal: {
      src: "/brand/miaomiao/states/state-appeal.webp",
      alt: "妙妙陪你等待申诉结果",
    },
    points: {
      src: "/brand/miaomiao/states/state-points.webp",
      alt: "妙妙提示积分还不够",
    },
    redeemed: {
      src: "/brand/miaomiao/states/state-redeemed.webp",
      alt: "妙妙庆祝礼物兑换成功",
    },
    failed: {
      src: "/brand/miaomiao/states/state-failed.webp",
      alt: "妙妙提示页面暂时没有加载出来",
    },
    retry: {
      src: "/brand/miaomiao/states/state-retry.webp",
      alt: "妙妙邀请你再试一次",
    },
  },
  scenes: {
    login: {
      src: "/brand/miaomiao/scenes/scene-login.webp",
      alt: "妙妙站在莓紫色直播舞台上欢迎剪辑团成员",
    },
    home: {
      src: "/brand/miaomiao/scenes/scene-home.webp",
      alt: "妙妙在直播高光手帐中向剪辑团成员打招呼",
    },
    videos: {
      src: "/brand/miaomiao/scenes/scene-videos.webp",
      alt: "妙妙身边环绕着直播时间轴和精彩切片",
    },
    mall: {
      src: "/brand/miaomiao/scenes/scene-mall.webp",
      alt: "妙妙在积分礼物屋里展示可兑换礼物",
    },
    rank: {
      src: "/brand/miaomiao/scenes/scene-rank.webp",
      alt: "妙妙站在彩带和奖杯点缀的排行舞台上",
    },
    profile: {
      src: "/brand/miaomiao/scenes/scene-profile.webp",
      alt: "妙妙在温暖的直播后台整理成员徽章",
    },
  },
  patterns: {
    lights: "/brand/miaomiao/patterns/pattern-lights.webp",
    comments: "/brand/miaomiao/patterns/pattern-comments.webp",
    timeline: "/brand/miaomiao/patterns/pattern-timeline.webp",
    points: "/brand/miaomiao/patterns/pattern-points.webp",
    ribbons: "/brand/miaomiao/patterns/pattern-ribbons.webp",
  },
} as const;

export type MiaoAssetKey =
  | keyof typeof miaoAssets.actions
  | keyof typeof miaoAssets.states
  | keyof typeof miaoAssets.scenes;
