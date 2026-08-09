'use client'

import { useCallback, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * ShimmerImage — 统一的图片加载体验。
 *
 * 加载中：shimmer 扫光骨架（skeleton-shimmer）
 * 加载完成：blur-up + 轻微回缩的物理淡入（ease-out-expo）
 *
 * 布局约定：组件本身不决定尺寸，由 containerClassName 控制
 * （如 "absolute inset-0" / "h-full w-full"），与原先裸 <img> 的
 * 占位方式保持一致，外部布局零改动。
 */
interface ShimmerImageProps
  extends Omit<React.ComponentProps<'img'>, 'onLoad'> {
  /** 外层容器 className（承担原 img 的定位/尺寸 className） */
  containerClassName?: string
  /** 外层容器内联样式（如覆盖 --skeleton-bg 适配深色背景） */
  containerStyle?: React.CSSProperties
  /** 淡入延迟（列表 stagger 用），秒 */
  fadeDelay?: number
  onLoad?: (event: React.SyntheticEvent<HTMLImageElement>) => void
}

function ShimmerImage({
  className,
  containerClassName,
  containerStyle,
  fadeDelay = 0,
  onLoad,
  ...props
}: ShimmerImageProps) {
  const [loaded, setLoaded] = useState(false)

  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    setLoaded(true)
    onLoad?.(event)
  }

  // 命中浏览器缓存时 onLoad 可能先于 React 挂载触发，ref 回调里兜底
  const ref = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) {
      setLoaded(true)
    }
  }, [])

  return (
    <div
      className={cn('shimmer-image-root overflow-hidden', containerClassName)}
      style={containerStyle}
    >
      {!loaded && (
        <div aria-hidden="true" className="skeleton-shimmer absolute inset-0" />
      )}
      <img
        {...props}
        ref={ref}
        onLoad={handleLoad}
        loading="lazy"
        decoding="async"
        style={{
          transitionDelay: loaded ? `${fadeDelay}s` : undefined,
        }}
        className={cn(
          'transition-[opacity,transform,filter] duration-500 ease-out-expo',
          loaded
            ? 'scale-100 opacity-100 blur-none'
            : 'scale-[1.02] opacity-0 blur-md',
          className,
        )}
      />
    </div>
  )
}

export { ShimmerImage }
