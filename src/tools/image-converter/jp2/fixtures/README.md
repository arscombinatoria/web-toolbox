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
