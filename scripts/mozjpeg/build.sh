#!/usr/bin/env bash
set -euo pipefail

# Same pinned Linux/amd64 Emscripten 4.0.20 image as scripts/webp/build.sh.
image=emscripten/emsdk@sha256:33e992367f721747d8008c9141c04fa017139e3557a60e0c80be93a0870fe462
repo=$(cd "$(dirname "$0")/../.." && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT

curl --fail --silent --show-error --location \
  https://github.com/mozilla/mozjpeg/archive/refs/tags/v4.1.5.tar.gz \
  -o "$build/source.tar.gz"
(
  cd "$build"
  echo '9fcbb7171f6ac383f5b391175d6fb3acde5e64c4c4727274eade84ed0998fcc1  source.tar.gz' | sha256sum -c -
)
cp "$repo/scripts/mozjpeg/encoder.c" "$build/encoder.c"
cp "$repo/scripts/mozjpeg/mem-dest-owner.patch" "$build/mem-dest-owner.patch"

# The container receives only the already-verified archive and wrapper.
docker run --rm --platform linux/amd64 --network none \
  -v "$build:/out" -w /work "$image" bash -euc '
  mkdir source
  tar -xzf /out/source.tar.gz -C source --strip-components=1
  patch -d source -p1 < /out/mem-dest-owner.patch
  cp /out/encoder.c .
  emcmake cmake -S source -B build -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_FLAGS="-O3 -msimd128 -flto -DNO_GETENV -sSUPPORT_LONGJMP=wasm" -DBUILD=20231012 \
    -DENABLE_SHARED=OFF -DENABLE_STATIC=ON -DPNG_SUPPORTED=OFF \
    -DWITH_12BIT=OFF -DWITH_ARITH_DEC=OFF -DWITH_ARITH_ENC=OFF \
    -DWITH_JAVA=OFF -DWITH_MEM_SRCDST=ON -DWITH_SIMD=OFF \
    -DWITH_TURBOJPEG=OFF
  cmake --build build --target jpeg-static --parallel
  emcc -O3 -msimd128 -flto -sSUPPORT_LONGJMP=wasm --no-entry -I source -I build encoder.c \
    build/libjpeg.a -sSTANDALONE_WASM=1 \
    -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=1073741824 -sSTACK_SIZE=5242880 \
    -sEXPORTED_FUNCTIONS=_malloc,_free,_mozjpeg_encode \
    -Wl,--why-extract=/work/link-inputs.tsv -o /work/mozjpeg-4.1.5-encoder.wasm
  cp /work/link-inputs.tsv /out/link-inputs.tsv
  if grep -Eq "jd(apimin|apistd|coefct|color|dctmgr|huff|icc|input|mainct|marker|master|merge|phuff|postct|sample|trans)\.c\.o|jidct(flt|fst|int|red)\.c\.o|jquant[12]\.c\.o|jpeg_(read|start_decompress|finish_decompress)|jpeg_mem_src|tj[A-Z]" /work/link-inputs.tsv; then
    grep -E "jd(apimin|apistd|coefct|color|dctmgr|huff|icc|input|mainct|marker|master|merge|phuff|postct|sample|trans)\.c\.o|jidct(flt|fst|int|red)\.c\.o|jquant[12]\.c\.o|jpeg_(read|start_decompress|finish_decompress)|jpeg_mem_src|tj[A-Z]" /work/link-inputs.tsv
    exit 1
  fi
  cat mozjpeg-4.1.5-encoder.wasm > /out/mozjpeg-4.1.5-encoder.wasm
'

cp "$build/mozjpeg-4.1.5-encoder.wasm" \
  "$repo/src/tools/image-converter/mozjpeg/mozjpeg-4.1.5-encoder.wasm"
sha256sum "$repo/src/tools/image-converter/mozjpeg/mozjpeg-4.1.5-encoder.wasm"
