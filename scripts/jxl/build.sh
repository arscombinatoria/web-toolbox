#!/usr/bin/env bash
set -euo pipefail

# Pinned Linux/amd64 Emscripten 4.0.20 image shared with the WebP/MozJPEG builds.
image=emscripten/emsdk@sha256:33e992367f721747d8008c9141c04fa017139e3557a60e0c80be93a0870fe462
repo=$(cd "$(dirname "$0")/../.." && pwd)
build=$(mktemp -d)
cleanup() {
  local status=$?
  if [[ $status -eq 0 ]]; then
    rm -rf "$build"
  else
    printf 'Build failed; preserving temporary build directory: %s\n' "$build" >&2
  fi
}
trap cleanup EXIT

fetch() {
  local url=$1 archive=$2 digest=$3
  curl --fail --silent --show-error --location "$url" -o "$build/$archive"
  (cd "$build" && echo "$digest  $archive" | sha256sum -c -)
}

# libjxl v0.13.0 (5a7da83447212fe4900fc29ce97430b881caa67e) and the exact
# encoder dependencies pinned in that release's deps.sh.
fetch https://github.com/libjxl/libjxl/archive/refs/tags/v0.13.0.tar.gz \
  libjxl.tar.gz 24d18c9af2d1f5a17730b3f8d3f70a5c16e5ac303f5d9d5fe9dc00cf7ca82af2
fetch https://github.com/google/brotli/archive/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d.tar.gz \
  brotli.tar.gz 113b9685dfc14dd2f3360d077283266eec2fbdfb0fe3e5600f11be151da0d68e
fetch https://github.com/google/highway/archive/457c891775a7397bdb0376bb1031e6e027af1c48.tar.gz \
  highway.tar.gz 5124b0501c98d9930dbb065bfa1a5bbbd59ce0f12facb7e1e33aaef01a5f1f1a
curl --fail --silent --show-error --location \
  https://skia.googlesource.com/skcms/+archive/074a8d439d75df5bff2746458306f7760ee74dd8.tar.gz \
  -o "$build/skcms.tar.gz"
mkdir "$build/skcms-src"
tar -xzf "$build/skcms.tar.gz" -C "$build/skcms-src"
skcms_sha=$(LC_ALL=C tar --sort=name --mtime='@0' --owner=0 --group=0 \
  --numeric-owner --format=gnu -cf - -C "$build/skcms-src" . | sha256sum | cut -d ' ' -f 1)
if [[ "$skcms_sha" != ac17fae715bba85a8280ff85936c1d5f63f8ea274b416ae74a5e5258bfab5569 ]]; then
  echo "Unexpected skcms source tree hash: $skcms_sha" >&2
  exit 1
fi

cp "$repo/scripts/jxl/encoder.c" "$build/encoder.c"
touch "$build/libjxl-0.13.0-encoder.wasm"
mkdir -p "$build/licenses" "$repo/public/licenses/jxl" \
  "$repo/src/tools/image-converter/jxl"

# All network access happens above; the reproducible build container runs offline.
docker run --rm --platform linux/amd64 --network none \
  -v "$build:/out" -w /work "$image" bash -euc '
  mkdir source
  tar -xzf /out/libjxl.tar.gz -C source --strip-components=1
  tar -xzf /out/brotli.tar.gz -C source/third_party/brotli --strip-components=1
  tar -xzf /out/highway.tar.gz -C source/third_party/highway --strip-components=1
  tar -xzf /out/skcms.tar.gz -C source/third_party/skcms
  cp /out/encoder.c .
  emcmake cmake -S source -B build -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_FLAGS="-O3 -msimd128 -flto" \
    -DCMAKE_CXX_FLAGS="-O3 -msimd128 -flto" \
    -DCMAKE_EXE_LINKER_FLAGS="-flto" \
    -DBUILD_TESTING=OFF -DJPEGXL_ENABLE_TOOLS=OFF \
    -DJPEGXL_ENABLE_EXAMPLES=OFF -DJPEGXL_ENABLE_DOXYGEN=OFF \
    -DJPEGXL_ENABLE_MANPAGES=OFF -DJPEGXL_ENABLE_BENCHMARK=OFF \
    -DJPEGXL_ENABLE_JNI=OFF -DJPEGXL_ENABLE_SJPEG=OFF \
    -DJPEGXL_ENABLE_OPENEXR=OFF -DJPEGXL_ENABLE_SKCMS=ON \
    -DJPEGXL_ENABLE_VIEWERS=OFF -DJPEGXL_ENABLE_TCMALLOC=OFF \
    -DJPEGXL_ENABLE_PLUGINS=OFF -DJPEGXL_ENABLE_TRANSCODE_JPEG=OFF \
    -DJPEGXL_ENABLE_BOXES=OFF -DJPEGXL_ENABLE_WASM_THREADS=OFF \
    -DJPEGXL_ENABLE_LTO=ON -DJPEGXL_BUNDLE_LIBPNG=OFF \
    -DJPEGXL_FORCE_SYSTEM_BROTLI=OFF -DJPEGXL_FORCE_SYSTEM_HWY=OFF
  cmake --build build --target jxl brotlienc hwy --parallel 2
  emcc -O3 -msimd128 -flto --no-entry -I source/lib/include -I build/lib/include encoder.c \
    build/lib/libjxl.a build/lib/libjxl_cms.a \
    build/third_party/highway/libhwy.a build/third_party/brotli/libbrotlienc.a \
    build/third_party/brotli/libbrotlicommon.a \
    -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1 \
    -sMAXIMUM_MEMORY=1073741824 -sSTACK_SIZE=5242880 \
    -sEXPORTED_FUNCTIONS=_malloc,_free,_jxl_encode,_jxl_output,_jxl_output_size,_jxl_free_output,_JxlEncoderVersion \
    -Wl,--why-extract=/out/link-inputs.tsv \
    -o /work/libjxl-0.13.0-encoder.wasm
  cp /work/libjxl-0.13.0-encoder.wasm /out/libjxl-0.13.0-encoder.wasm
  # The libjxl static archive contains shared encoder/decoder helper units.
  # Permit those when required, while rejecting the public decoder entry unit,
  # decoder API symbols, and the Brotli decoder archive.
  if grep -Eiq "libjxl\.a\(decode\.cc\.o\)|JxlDecoder|libbrotlidec\.a\(" /out/link-inputs.tsv; then
    grep -Ei "libjxl\.a\(decode\.cc\.o\)|JxlDecoder|libbrotlidec\.a\(" /out/link-inputs.tsv
    exit 1
  fi
  cp source/LICENSE /out/licenses/LICENSE.libjxl
  cp source/AUTHORS /out/licenses/AUTHORS
  cp source/PATENTS /out/licenses/PATENTS
  cp source/third_party/brotli/LICENSE /out/licenses/LICENSE.brotli
  cp source/third_party/highway/LICENSE /out/licenses/LICENSE.highway
  cp source/third_party/skcms/LICENSE /out/licenses/LICENSE.skcms
'

for runtime_license in LICENSE.Emscripten LICENSE.libcxx LICENSE.libcxxabi LICENSE.compiler-rt \
  COPYRIGHT.musl CREDITS.libcxx CREDITS.libcxxabi CREDITS.compiler-rt \
  AUTHORS.Emscripten; do
  cp "$repo/public/licenses/webp/$runtime_license" "$build/licenses/"
done
cp "$build/libjxl-0.13.0-encoder.wasm" \
  "$repo/src/tools/image-converter/jxl/libjxl-0.13.0-encoder.wasm"
cp "$build"/licenses/* "$repo/public/licenses/jxl/"
sha256sum "$repo/src/tools/image-converter/jxl/libjxl-0.13.0-encoder.wasm"
