import Image from "next/image";
import {
  fmtEngagementRate,
  fmtFollowers,
  fmtPostCount,
  type AthleteSocialData,
} from "@/lib/athlete-data";

type PlatformDef = {
  id: string;
  label: string;
  iconSrc?: string;
  iconAlt?: string;
  followersKey?: keyof AthleteSocialData;
  erKey?: keyof AthleteSocialData;
  postsKey?: keyof AthleteSocialData;
};

const PLATFORMS: PlatformDef[] = [
  {
    id: "total",
    label: "Total",
    followersKey: "total_followers",
    erKey: "avg_er_20p",
    postsKey: "total_lifetime_posts",
  },
  {
    id: "ig",
    label: "Instagram",
    iconSrc: "/icons/social/instagram.png",
    iconAlt: "Instagram",
    followersKey: "ig_followers",
    erKey: "avg_er_ig_20p",
    postsKey: "ig_lifetime_posts",
  },
  {
    id: "tt",
    label: "TikTok",
    iconSrc: "/icons/social/tiktok.png",
    iconAlt: "TikTok",
    followersKey: "tt_followers",
    erKey: "avg_er_tt_20p",
    postsKey: "tt_lifetime_posts",
  },
  {
    id: "fb",
    label: "Facebook",
    iconSrc: "/icons/social/facebook.png",
    iconAlt: "Facebook",
    followersKey: "fb_followers",
    erKey: "avg_er_fb_20p",
    postsKey: "fb_lifetime_posts",
  },
  {
    id: "x",
    label: "X",
    iconSrc: "/icons/social/x.png",
    iconAlt: "X",
    followersKey: "x_followers",
    erKey: "avg_er_x_20p",
    postsKey: "x_lifetime_posts",
  },
];

function hasMetric(social: AthleteSocialData, key: keyof AthleteSocialData | undefined): boolean {
  if (!key) return false;
  const val = social[key];
  return val != null && Number.isFinite(Number(val));
}

function platformVisible(social: AthleteSocialData, platform: PlatformDef): boolean {
  return (
    hasMetric(social, platform.followersKey) ||
    hasMetric(social, platform.erKey) ||
    hasMetric(social, platform.postsKey)
  );
}

function MetricPart({
  label,
  value,
  showSep,
}: {
  label: string;
  value: string;
  showSep: boolean;
}) {
  return (
    <>
      {showSep ? <span className="text-[#B9B2A6]"> · </span> : null}
      <span>
        <span className="text-[#B9B2A6]">{label}: </span>
        {value}
      </span>
    </>
  );
}

function PlatformCard({ social, platform }: { social: AthleteSocialData; platform: PlatformDef }) {
  const showFollowers = hasMetric(social, platform.followersKey);
  const showEr = hasMetric(social, platform.erKey);
  const showPosts = hasMetric(social, platform.postsKey);

  return (
    <div className="rounded-lg border border-white/10 bg-[#121614] p-3">
      <div className="flex items-center gap-2">
        {platform.iconSrc ? (
          <Image
            src={platform.iconSrc}
            alt={platform.iconAlt ?? platform.label}
            width={18}
            height={18}
            className="shrink-0"
          />
        ) : null}
        <span className="text-sm font-medium text-[#D7D0C4]">{platform.label}</span>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-1 gap-y-0.5 text-sm leading-snug text-[#ECE7DF]">
        {showFollowers && (
          <MetricPart
            label="Followers"
            value={fmtFollowers(social[platform.followersKey!] as number | null)}
            showSep={false}
          />
        )}
        {showEr && (
          <MetricPart
            label="ER"
            value={fmtEngagementRate(social[platform.erKey!] as number | null)}
            showSep={showFollowers}
          />
        )}
        {showPosts && (
          <MetricPart
            label="Posts"
            value={fmtPostCount(social[platform.postsKey!] as number | null)}
            showSep={showFollowers || showEr}
          />
        )}
      </p>
    </div>
  );
}

type Props = {
  social: AthleteSocialData | null;
};

export function SocialPlatformMetrics({ social }: Props) {
  if (!social) return null;

  const visible = PLATFORMS.filter((p) => platformVisible(social, p));
  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {visible.map((platform) => (
        <PlatformCard key={platform.id} social={social} platform={platform} />
      ))}
    </div>
  );
}
