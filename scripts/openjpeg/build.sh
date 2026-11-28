#!/usr/bin/env bash
set -euo pipefail

# Pinned Linux/amd64 Emscripten 4.0.20 image shared with the other image codecs.
image=emscripten/emsdk@sha256:33e992367f721747d8008c9141c04fa017139e3557a60e0c80be93a0870fe462
repo=$(cd "$(dirname "$0")/../.." && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT

# OpenJPEG upstream HEAD observed 2026-11-28, plus the reviewed fix from open PR
# #1674 for CVE-2026-107080. Upstream says the repository is unmaintained.
curl --fail --silent --show-error --location \
  https://github.com/uclouvain/openjpeg/archive/8314119b067c0fc77834731168daaebd379fdb12.tar.gz \
  -o "$build/source.tar.gz"
(
  cd "$build"
  echo 'e723e8babb2188e8743308842bb1bfc9809f0375cd964cfeac2fb17285094321  source.tar.gz' | sha256sum -c -
)
cp "$repo/scripts/openjpeg/codec.c" "$build/codec.c"
cp "$repo/scripts/openjpeg/cve-2026-107080.patch" "$build/cve-2026-107080.patch"

# Only verified inputs enter the network-isolated reproducible build container.
docker run --rm --platform linux/amd64 --network none \
  -v "$build:/out" -w /work "$image" bash -euc '
  mkdir source
  tar -xzf /out/source.tar.gz -C source --strip-components=1
  patch -d source -p1 < /out/cve-2026-107080.patch
  cp /out/codec.c .
  emcmake cmake -S source -B build -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_FLAGS="-O3 -msimd128 -flto" \
    -DBUILD_SHARED_LIBS=OFF -DBUILD_STATIC_LIBS=ON -DBUILD_CODEC=OFF \
    -DBUILD_TESTING=OFF -DBUILD_DOC=OFF -DBUILD_JPIP=OFF \
    -DBUILD_UNIT_TESTS=OFF -DBUILD_LUTS_GENERATOR=OFF -DOPJ_USE_THREAD=OFF
  cmake --build build --target openjp2 --parallel 2
  emcc -O3 -msimd128 -flto --no-entry -I source/src/lib/openjp2 -I build/src/lib/openjp2 codec.c \
    build/bin/libopenjp2.a -sSTANDALONE_WASM=1 -sFILESYSTEM=0 \
    -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=1073741824 -sSTACK_SIZE=5242880 \
    -sEXPORTED_FUNCTIONS=_malloc,_free,_jp2_encode,_jp2_output,_jp2_output_size,_jp2_clear_output,_jp2_decode,_jp2_width,_jp2_height \
    -Wl,--why-extract=/out/link-inputs.tsv \
    -o /out/openjpeg-2.5.4-8314119b-encoder-decoder.wasm
  cp source/LICENSE /out/LICENSE.openjpeg
'

mkdir -p "$repo/public/licenses/openjpeg" "$repo/src/tools/image-converter/jp2"
for runtime_license in LICENSE.Emscripten LICENSE.libcxx LICENSE.libcxxabi LICENSE.compiler-rt \
  COPYRIGHT.musl CREDITS.libcxx CREDITS.libcxxabi CREDITS.compiler-rt AUTHORS.Emscripten; do
  cp "$repo/public/licenses/webp/$runtime_license" "$build/"
done
cp "$repo/public/licenses/jpegli/COPYRIGHT.dlmalloc" "$build/"
cp "$build/LICENSE.openjpeg" "$repo/public/licenses/openjpeg/LICENSE"
cp "$build"/LICENSE.Emscripten "$build"/LICENSE.compiler-rt "$build"/LICENSE.libcxx "$build"/LICENSE.libcxxabi \
  "$repo/public/licenses/openjpeg/"
cp "$build"/COPYRIGHT.dlmalloc "$build"/COPYRIGHT.musl "$build"/CREDITS.* "$build"/AUTHORS.Emscripten \
  "$repo/public/licenses/openjpeg/"
if grep -q 'libunwind' "$build/link-inputs.tsv"; then
  cp "$repo/public/licenses/jpegli/LICENSE.libunwind" "$repo/public/licenses/openjpeg/"
  cp "$repo/public/licenses/jpegli/CREDITS.libunwind" "$repo/public/licenses/openjpeg/"
fi
chmod 0644 "$repo"/public/licenses/openjpeg/*
cp "$build/openjpeg-2.5.4-8314119b-encoder-decoder.wasm" \
  "$repo/src/tools/image-converter/jp2/"
chmod 0644 "$repo/src/tools/image-converter/jp2/openjpeg-2.5.4-8314119b-encoder-decoder.wasm"
sha256sum "$repo/src/tools/image-converter/jp2/openjpeg-2.5.4-8314119b-encoder-decoder.wasm"
