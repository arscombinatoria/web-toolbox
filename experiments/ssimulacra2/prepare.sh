#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "$0")"
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
npm pack --ignore-scripts --pack-destination "$temp" bytecut-ssimulacra2@0.1.0
(
  cd "$temp"
  node --input-type=module <<'JS'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const expected = 'NX/p5QYzGgPJoGWwEFiOl4+9DbaEooikLZxf6nsQ2110LuEGlQ611WrvWN8gXKMYZlUUW4ETN6yW1xPRJ5mq9w==';
const actual = createHash('sha512').update(readFileSync('bytecut-ssimulacra2-0.1.0.tgz')).digest('base64');
if (actual !== expected) throw new Error('npm tarball integrity mismatch');
JS
  tar -xzf bytecut-ssimulacra2-0.1.0.tgz package/ssimulacra2.wasm package/LICENSE package/NOTICE
  sha256sum -c <<< '56ae71e4b0e1d72d3afbcf2821ec913e0d775806f3c745960ea3a0504f402648  package/ssimulacra2.wasm'
  curl -fsSL https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/astronaut.png -o astronaut.png
  sha256sum -c <<< '88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5  astronaut.png'
)
mkdir -p assets public/third-party
cp "$temp/package/ssimulacra2.wasm" "$temp/astronaut.png" assets/
cp "$temp/package/"{LICENSE,NOTICE} public/third-party/
