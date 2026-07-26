import Image from "next/image";

export function BrandIcon({ className = "brand-mark" }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <path d="M8 11.5h24v15H20l-6.5 5v-5H8z" />
        <path d="M14 18.8h4.2l2-3.4 2.2 7 2-3.6H28" />
        <circle cx="29.5" cy="10.5" r="4.5" />
      </svg>
    </span>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup ${compact ? "compact" : ""}`}>
      <BrandIcon />
      <span className="brand-name">
        <strong>妙妙剪辑团</strong>
        {!compact && <small>直播高光积分站</small>}
      </span>
    </div>
  );
}

export function PageScene({
  src,
  alt,
  eager = false,
}: {
  src: string;
  alt: string;
  eager?: boolean;
}) {
  return (
    <span className="page-scene" aria-hidden={alt ? undefined : true}>
      <Image src={src} alt={alt} width={520} height={360} priority={eager} sizes="(max-width: 760px) 42vw, 280px" />
    </span>
  );
}

export function StateMessage({
  src,
  alt,
  children,
}: {
  src: string;
  alt: string;
  children: React.ReactNode;
}) {
  return (
    <div className="state-message">
      <Image src={src} alt={alt} width={240} height={240} loading="lazy" sizes="160px" />
      <p>{children}</p>
    </div>
  );
}
