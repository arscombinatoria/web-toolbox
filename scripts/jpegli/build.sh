#!/usr/bin/env bash
set -euo pipefail

# Linux/amd64 Emscripten 4.0.20 image also used by the other image encoders.
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

# Exact source commits recorded by JPEGli c7d342c's deps.sh.
fetch https://github.com/google/jpegli/archive/c7d342c25d3587ac0110c915989ad94f414b6c8d.tar.gz \
  jpegli.tar.gz ba9ffab3d55b75c853c385b01ec1b1537845263267ca3094f3ecc8e86c5d0c32
fetch https://github.com/google/highway/archive/271a9a0ed9de1232d9117f1572c3fe28f8542ec1.tar.gz \
  highway.tar.gz c42bcfe44d100223ea0043acb3da6de703103ca44bfb1d46b577c90939177f5f
fetch https://github.com/libjpeg-turbo/libjpeg-turbo/archive/8ecba3647edb6dd940463fedf38ca33a8e2a73d1.tar.gz \
  libjpeg-turbo.tar.gz ed729127097af5000bfeddc6b3e679c4363bb1618ebfc07efb6b47f576471b4b
fetch https://github.com/google/skcms/archive/96d9171c94b937a1b5f0293de7309ac16311b722.tar.gz \
  skcms.tar.gz 9bb4b5bba0b7c04f6c2bce9ff713d61e23c9a20c4945161ae16290498ad74627

cp "$repo/scripts/jpegli/encoder.cc" "$build/encoder.cc"
cp "$repo/scripts/jpegli/wasm-exceptions.patch" "$build/wasm-exceptions.patch"
mkdir -p "$repo/public/licenses/jpegli" \
  "$repo/src/tools/image-converter/jpegli"

build_once() {
  local run=$1
  mkdir -p "$build/$run/work"
  # The build container has no network access. Each build unpacks fresh verified
  # source trees into a separate directory to make the byte comparison useful.
  docker run --rm --platform linux/amd64 --network none \
    -v "$build:/out" -v "$build/$run/work:/work" -w /work "$image" bash -euc '
    run="$1"
    mkdir -p /work/source/third_party /work/source/third_party/highway \
      /work/source/third_party/libjpeg-turbo /work/source/third_party/skcms
    tar -xzf /out/jpegli.tar.gz -C /work/source --strip-components=1
    tar -xzf /out/highway.tar.gz -C /work/source/third_party/highway --strip-components=1
    tar -xzf /out/libjpeg-turbo.tar.gz -C /work/source/third_party/libjpeg-turbo --strip-components=1
    tar -xzf /out/skcms.tar.gz -C /work/source/third_party/skcms --strip-components=1
    patch -d /work/source -p1 < /out/wasm-exceptions.patch
    cp /out/encoder.cc /work/encoder.cc
    emcmake cmake -S /work/source -B /work/build \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_C_FLAGS="-O3 -msimd128 -flto -fwasm-exceptions" \
      -DCMAKE_CXX_FLAGS="-O3 -msimd128 -flto -fwasm-exceptions" \
      -DCMAKE_EXE_LINKER_FLAGS="-flto -fwasm-exceptions" \
      -DBUILD_TESTING=OFF -DJPEGLI_ENABLE_TOOLS=OFF \
      -DJPEGLI_ENABLE_JPEGLI_LIBJPEG=OFF -DJPEGLI_ENABLE_DOXYGEN=OFF \
      -DJPEGLI_ENABLE_MANPAGES=OFF -DJPEGLI_ENABLE_BENCHMARK=OFF \
      -DJPEGLI_ENABLE_JNI=OFF -DJPEGLI_ENABLE_SJPEG=OFF \
      -DJPEGLI_ENABLE_OPENEXR=OFF -DJPEGLI_ENABLE_SKCMS=ON \
      -DJPEGLI_ENABLE_TCMALLOC=OFF -DJPEGLI_ENABLE_WASM_THREADS=OFF \
      -DJPEGLI_ENABLE_LTO=ON -DJPEGLI_BUNDLE_LIBPNG=OFF \
      -DJPEGLI_FORCE_SYSTEM_HWY=OFF
    cmake --build /work/build --target jpegli-static hwy --parallel 2
    em++ -O3 -msimd128 -flto -fwasm-exceptions --no-entry \
      -I /work/source \
      -I /work/build/lib/include/jpegli \
      -I /work/build/lib/include \
      /work/encoder.cc \
      /work/build/lib/libjpegli-static.a \
      /work/build/third_party/highway/libhwy.a \
      -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1 \
      -sMAXIMUM_MEMORY=1073741824 -sSTACK_SIZE=5242880 \
      -sEXPORTED_FUNCTIONS=_malloc,_free,_jpegli_encode \
      -Wl,--why-extract="/out/$run-link-inputs.tsv" \
      -o "/out/jpegli-encoder-$run.wasm"
    # Reject public decode entry points and decoder-only archives if they are
    # accidentally pulled into the encoder artifact.
    if grep -Eiq "libjpegli-static\.a\((decode(_marker|_scan)?|source_manager|idct|render|upsample|destination_manager)\.cc\.o\)|jpegli_(read_header|start_decompress|finish_decompress|read_scanlines)|JpegliDecode" \
      "/out/$run-link-inputs.tsv"; then
      cat "/out/$run-link-inputs.tsv"
      exit 1
    fi
    if awk -F "\t" '\''NR > 1 && $2 ~ /libhwy\.a\(/ && $2 !~ /libhwy\.a\((abort|aligned_allocator)\.cc\.o\)/ { print; bad = 1 } END { exit bad ? 0 : 1 }'\'' \
      "/out/$run-link-inputs.tsv"; then
      echo "Unexpected Highway object linked into the encoder" >&2
      exit 1
    fi
    grep -q "libjpegli-static.a(encode.cc.o)" "/out/$run-link-inputs.tsv"
    grep -q "libhwy.a(aligned_allocator.cc.o)" "/out/$run-link-inputs.tsv"
  ' bash "$run"
}

build_once first
build_once second
cmp "$build/jpegli-encoder-first.wasm" "$build/jpegli-encoder-second.wasm"
install -m 644 "$build/jpegli-encoder-first.wasm" \
  "$repo/src/tools/image-converter/jpegli/jpegli-c7d342c25d3587ac0110c915989ad94f414b6c8d-encoder.wasm"

# Carry source and toolchain license texts with this separately distributed
# encoder, including the runtime components Emscripten links into Wasm.
mkdir -p "$build/licenses"
docker run --rm --platform linux/amd64 --network none \
  -v "$build:/out" -w /work "$image" bash -euc '
  mkdir source
  tar -xzf /out/jpegli.tar.gz -C source --strip-components=1
  tar -xzf /out/highway.tar.gz -C source/third_party/highway --strip-components=1
  tar -xzf /out/libjpeg-turbo.tar.gz -C source/third_party/libjpeg-turbo --strip-components=1
  cp source/LICENSE /out/licenses/LICENSE.jpegli
  cp source/AUTHORS /out/licenses/AUTHORS
  cp source/PATENTS /out/licenses/PATENTS
  cp source/third_party/highway/LICENSE /out/licenses/LICENSE.highway
  cp source/third_party/libjpeg-turbo/LICENSE.md /out/licenses/LICENSE.libjpeg-turbo
  cp source/third_party/libjpeg-turbo/README.ijg /out/licenses/README.ijg
  cp /emsdk/upstream/emscripten/system/lib/libunwind/LICENSE.TXT \
    /out/licenses/LICENSE.libunwind
'
for runtime_license in LICENSE.Emscripten LICENSE.libcxx LICENSE.libcxxabi \
  LICENSE.compiler-rt COPYRIGHT.musl CREDITS.libcxx CREDITS.libcxxabi \
  CREDITS.compiler-rt AUTHORS.Emscripten; do
  cp "$repo/public/licenses/webp/$runtime_license" "$build/licenses/"
done
cp "$build"/licenses/* "$repo/public/licenses/jpegli/"
sha256sum "$repo/src/tools/image-converter/jpegli/jpegli-c7d342c25d3587ac0110c915989ad94f414b6c8d-encoder.wasm"
