const px = (id: number, width: number, height: number, ext: "jpeg" | "png" = "jpeg") =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.${ext}?auto=compress&cs=tinysrgb&fit=crop&w=${width}&h=${height}&dpr=1`;

export const PHOTOS = {
  hero: {
    // A studio shot on a white background, and that is the point: the card it
    // sits in is white too and the image is drawn with `object-contain`, so the
    // photograph's own background disappears into the card and the subject is
    // shown whole. Nothing is cropped -- the requested 2:3 matches the original
    // frame, so the CDN has nothing to cut -- and there is no cut-out file to
    // keep in sync with the layout. A coloured or textured background would show
    // as a rectangle here, which is exactly what this choice avoids.
    url: px(9422865, 1080, 1620),
    alt: "Woman smiling while holding up her smartphone",
    credit: "Photo by Guto Macedo on Pexels",
  },
  socialProof: [
    { url: px(6497114, 96, 96), alt: "Smiling woman with braided hair in a green top" },
    { url: px(14950779, 96, 96), alt: "Smiling man wearing a beanie" },
    { url: px(7717254, 96, 96), alt: "Smiling woman with braided hair on a dark background" },
    { url: px(19399318, 96, 96), alt: "Man in traditional wear in Benin City, Nigeria" },
  ],
  testimonials: {
    tola: { url: px(6497112, 96, 96), alt: "Close-up portrait of a smiling woman with braids" },
    chidera: { url: px(19518397, 96, 96), alt: "Smiling man in a sweater holding a smartphone" },
    ifeanyi: { url: px(31422830, 96, 96, "png"), alt: "Portrait of a man in an office" },
  },
} as const;
