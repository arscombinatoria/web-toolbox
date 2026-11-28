# JPEG 2000 decoder fixtures

These fixtures were generated outside the Wasm wrapper.

- `external-rgb.j2k` is a lossless raw codestream made from `source.ppm` with
  ImageMagick 6.9.11's JPEG 2000 delegate (OpenJPEG 2.5.3). The test compares
  all decoded RGBA bytes with the source pixels.
- `external-gray16.jp2` and `external-sycc420.jp2` were generated with native
  FFmpeg using lossless 5/3 DWT from 16-bit gray and 8-bit 4:2:0 sYCC raw
  frames. Tests cover 16-to-8-bit gray normalization and the OpenJPEG
  sYCC-to-RGB conversion coefficients.
- `external-sycc420-odd-origin.jp2` was generated with the native OpenJPEG
  2.5.3 API and 4:2:0 components at an odd image origin. Its generator is
  `scripts/openjpeg/fixtures/generate-odd-sycc.c`; the test checks OpenJPEG's
  edge padding for that reference grid.
- `external-gray-alpha-cdef.jp2` was generated from FFmpeg's lossless `ya8`
  output. Its JP2 header was normalized to grayscale and given standard
  opacity channel definitions. Tests verify grayscale and straight alpha.
- `external-low-depth-gray1.jp2`, `external-low-depth-gray4.jp2`,
  `external-low-depth-signed-gray4.jp2`,
  `external-low-depth-gray-alpha1.jp2`, and `external-low-depth-sycc4.jp2`
  were generated independently of the browser Wasm wrapper with the native
  OpenJPEG API from the pinned upstream source commit recorded in
  `public/licenses/openjpeg/DEPENDENCIES.txt`. The
  fixture generator is `scripts/openjpeg/fixtures/generate-low-depth.c`. It
  encodes explicit 1-bit and 4-bit components, including signed grayscale,
  1-bit straight alpha, and 4-bit sYCC with neutral and non-neutral chroma,
  with reversible 5/3 DWT. Tests verify exact endpoint, midpoint, alpha, and
  neutral chroma handling. The prior 8-bit lossless RGBA, 16-bit grayscale,
  and subsampled sYCC fixtures remain covered by the same Wasm test.

To regenerate these files, compile the generator against a native build of
the pinned OpenJPEG source (the same source archive SHA and SDK container are
recorded in `public/licenses/openjpeg/DEPENDENCIES.txt`):

```sh
cc -O2 -I source/src/lib/openjp2 -I build/src/lib/openjp2 \
  scripts/openjpeg/fixtures/generate-low-depth.c build/bin/libopenjp2.a -lm \
  -o /tmp/generate-low-depth
/tmp/generate-low-depth src/tools/image-converter/jp2/fixtures
```
