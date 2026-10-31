import type { ImgHTMLAttributes } from 'react';

/** Screens narrower than this (Tailwind's `md`) show the phone picture. */
const PHONE_MEDIA = '(max-width: 767px)';

/**
 * A CMS picture with its separate phone version (CMS → Site content: the
 * "mobile" upload): phones get `mobileSrc`, larger screens `src`. Without a
 * phone version it is a plain <img>.
 */
export function PhonePicture({
  src,
  mobileSrc,
  alt,
  ...img
}: ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string; mobileSrc?: string }) {
  if (!mobileSrc) return <img src={src} alt={alt} {...img} />;
  return (
    <picture>
      <source media={PHONE_MEDIA} srcSet={mobileSrc} />
      <img src={src} alt={alt} {...img} />
    </picture>
  );
}
