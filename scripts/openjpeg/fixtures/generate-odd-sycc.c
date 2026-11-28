/* Generate the nonzero-origin sYCC fixture with the native OpenJPEG API. */
#include <stdio.h>
#include <string.h>
#include <openjpeg.h>

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: %s OUTPUT.jp2\n", argv[0]);
    return 1;
  }
  opj_image_cmptparm_t cp[3];
  memset(cp, 0, sizeof(cp));
  cp[0].dx = cp[0].dy = 1; cp[0].w = cp[0].h = 4;
  cp[0].x0 = cp[0].y0 = 1; cp[0].prec = 8;
  cp[1].dx = cp[1].dy = 2; cp[1].w = cp[1].h = 2;
  cp[1].x0 = cp[1].y0 = 1; cp[1].prec = 8;
  cp[2] = cp[1];
  opj_image_t *image = opj_image_create(3, cp, OPJ_CLRSPC_SYCC);
  if (!image) return 2;
  image->x0 = image->y0 = 1; image->x1 = image->y1 = 5;
  for (unsigned i = 0; i < 16; ++i) image->comps[0].data[i] = 128;
  const int cb[4] = {128, 90, 160, 128};
  const int cr[4] = {128, 150, 128, 200};
  for (unsigned i = 0; i < 4; ++i) {
    image->comps[1].data[i] = cb[i]; image->comps[2].data[i] = cr[i];
  }
  opj_cparameters_t params;
  opj_set_default_encoder_parameters(&params);
  params.tcp_numlayers = 1; params.cp_disto_alloc = 1; params.tcp_rates[0] = 0;
  params.numresolution = 2; params.irreversible = 0; params.tcp_mct = 0;
  opj_codec_t *codec = opj_create_compress(OPJ_CODEC_JP2);
  if (!codec || !opj_setup_encoder(codec, &params, image)) return 3;
  opj_stream_t *stream = opj_stream_create_default_file_stream(argv[1], OPJ_FALSE);
  if (!stream) return 4;
  OPJ_BOOL ok = opj_start_compress(codec, image, stream) && opj_encode(codec, stream) &&
                opj_end_compress(codec, stream);
  opj_stream_destroy(stream); opj_destroy_codec(codec); opj_image_destroy(image);
  return ok ? 0 : 5;
}
