"use client";

import { useState } from "react";
import Image from "next/image";

type GalleryImage = {
  src: string;
  alt: string;
};

export default function ProductGallery({ images }: { images: GalleryImage[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[activeIndex];

  return (
    <div>
      <div className="overflow-hidden rounded-3xl border border-border bg-surface">
        <Image
          src={active.src}
          alt={active.alt}
          width={800}
          height={800}
          className="h-auto w-full"
          priority
        />
      </div>
      <div
        role="tablist"
        aria-label="Productafbeeldingen"
        className="mt-4 grid grid-cols-4 gap-3"
      >
        {images.map((image, index) => (
          <button
            key={image.src}
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            aria-label={image.alt}
            onClick={() => setActiveIndex(index)}
            className={`overflow-hidden rounded-xl border transition-colors ${
              index === activeIndex
                ? "border-accent ring-2 ring-accent"
                : "border-border hover:border-accent"
            }`}
          >
            <Image
              src={image.src}
              alt=""
              width={160}
              height={160}
              className="h-auto w-full"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
