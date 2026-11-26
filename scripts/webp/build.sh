#!/usr/bin/env bash
set -euo pipefail

# Docker image for Emscripten 4.0.20, Linux amd64.
image=emscripten/emsdk@sha256:33e992367f721747d8008c9141c04fa017139e3557a60e0c80be93a0870fe462
repo=$(cd "$(dirname "$0")/../.." && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT

curl --fail --silent --show-error --location \
  https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz \
  -o "$build/source.tar.gz"
(
  cd "$build"
  echo 'e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564  source.tar.gz' | sha256sum -c -
)
cp "$repo/scripts/webp/encoder.c" "$build/encoder.c"
touch "$build/libwebp-1.6.0-encoder.wasm"

# Build locally from verified sources. No network is needed in the container.
docker run --rm --platform linux/amd64 --network none \
  -v "$build:/out" -w /work "$image" bash -euc '
  mkdir source
  tar -xzf /out/source.tar.gz -C source --strip-components=1
  cp /out/encoder.c .
  emcmake cmake -S source -B build -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_FLAGS="-msimd128 -flto" -DWEBP_USE_THREAD=OFF \
    -DWEBP_BUILD_ANIM_UTILS=OFF -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF \
    -DWEBP_BUILD_GIF2WEBP=OFF -DWEBP_BUILD_IMG2WEBP=OFF -DWEBP_BUILD_VWEBP=OFF \
    -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_LIBWEBPMUX=OFF -DWEBP_BUILD_WEBPMUX=OFF \
    -DWEBP_BUILD_EXTRAS=OFF
  cmake --build build --target webp --parallel
  emcc -O3 -msimd128 -flto --no-entry -I source/src encoder.c \
    build/libwebp.a build/libsharpyuv.a -sSTANDALONE_WASM=1 \
    -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=1073741824 -sSTACK_SIZE=5242880 \
    -sEXPORTED_FUNCTIONS=_malloc,_free,_encode_webp,_webp_output,_clear_webp_output,_WebPGetEncoderVersion \
    -Wl,--why-extract=/work/link-inputs.tsv -o /work/libwebp-1.6.0-encoder.wasm
  # WebP encoder also uses shared DSP and utility functions. No decoder
  # translation unit, decoder API, demuxer or muxer should be linked.
  if grep -Eq "_dec\\.c\\.o|WebPDecode|WebPDemux|WebPMux" /work/link-inputs.tsv; then
    cat /work/link-inputs.tsv
    exit 1
  fi
  cat libwebp-1.6.0-encoder.wasm > /out/libwebp-1.6.0-encoder.wasm
'
cp "$build/libwebp-1.6.0-encoder.wasm" "$repo/src/tools/image-converter/webp/"
sha256sum "$repo/src/tools/image-converter/webp/libwebp-1.6.0-encoder.wasm"
