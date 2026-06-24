type SkeletonVariant = 'card' | 'row' | 'block' | 'text';

type SkeletonProps = {
  variant: SkeletonVariant;
  count?: number;
  width?: number | string;
  height?: number | string;
};

const variants: Record<SkeletonVariant, { defaultWidth: number | string; defaultHeight: number | string }> = {
  card: { defaultWidth: '100%', defaultHeight: 80 },
  row:  { defaultWidth: '100%', defaultHeight: 24 },
  block: { defaultWidth: '100%', defaultHeight: 120 },
  text: { defaultWidth: '60%', defaultHeight: 16 },
};

export default function Skeleton({ variant, count = 1, width, height }: SkeletonProps) {
  const dims = variants[variant];
  const w = width ?? dims.defaultWidth;
  const h = height ?? dims.defaultHeight;
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          role="status"
          aria-label="加载中"
          style={{
            width: w, height: h, margin: '8px 0',
            background: '#e8e8e8', borderRadius: 4,
            animation: 'skeleton-pulse 1.5s ease-in-out infinite',
          }}
        />
      ))}
      <style>{`@keyframes skeleton-pulse { 0%,100% { opacity: 0.6 } 50% { opacity: 1 } }`}</style>
    </>
  );
}