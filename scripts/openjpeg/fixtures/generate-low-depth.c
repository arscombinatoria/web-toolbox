#include <openjpeg.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>

static void quiet(const char *message, void *data) {
  (void)message;
  (void)data;
}

static int write_image(const char *path, uint32_t components, uint32_t precision,
                       int signed_samples, OPJ_COLOR_SPACE color_space,
                       const int32_t *samples) {
  opj_cparameters_t parameters;
  opj_set_default_encoder_parameters(&parameters);
  parameters.tcp_numlayers = 1;
  parameters.tcp_rates[0] = 0;
  parameters.cp_disto_alloc = 1;
  parameters.irreversible = 0;
  parameters.numresolution = 2;

  opj_image_cmptparm_t component_parameters[3];
  memset(component_parameters, 0, sizeof(component_parameters));
  for (uint32_t i = 0; i < components; ++i) {
    component_parameters[i].dx = component_parameters[i].dy = 1;
    component_parameters[i].w = 4;
    component_parameters[i].h = 2;
    component_parameters[i].prec = precision;
    component_parameters[i].sgnd = signed_samples;
  }
  if (color_space == OPJ_CLRSPC_SYCC) parameters.tcp_mct = 0;
  opj_image_t *image = opj_image_create(components, component_parameters, color_space);
  if (!image) return 1;
  image->x1 = 4;
  image->y1 = 2;
  if (components == 2) image->comps[1].alpha = 1;
  for (uint32_t c = 0; c < components; ++c)
    memcpy(image->comps[c].data, samples + c * 8, 8 * sizeof(int32_t));

  opj_codec_t *codec = opj_create_compress(OPJ_CODEC_JP2);
  opj_stream_t *stream = opj_stream_create_default_file_stream(path, OPJ_FALSE);
  if (!codec || !stream) {
    if (codec) opj_destroy_codec(codec);
    if (stream) opj_stream_destroy(stream);
    opj_image_destroy(image);
    return 1;
  }
  opj_set_error_handler(codec, quiet, NULL);
  opj_set_warning_handler(codec, quiet, NULL);
  opj_set_info_handler(codec, quiet, NULL);
  int ok = opj_setup_encoder(codec, &parameters, image) &&
           opj_start_compress(codec, image, stream) &&
           opj_encode(codec, stream) && opj_end_compress(codec, stream);
  opj_stream_destroy(stream);
  opj_destroy_codec(codec);
  opj_image_destroy(image);
  return ok ? 0 : 1;
}

int main(int argc, char **argv) {
  static const int32_t gray1[8] = {0, 1, 0, 1, 1, 0, 1, 0};
  static const int32_t gray4[8] = {0, 4, 8, 15, 15, 8, 4, 0};
  static const int32_t signed_gray4[8] = {-8, -4, 0, 7, 7, 0, -4, -8};
  static const int32_t gray_alpha1[16] = {
    0, 1, 0, 1, 1, 0, 1, 0,
    0, 1, 1, 0, 0, 1, 0, 1,
  };
  static const int32_t sycc4[24] = {
    8, 8, 8, 8, 8, 8, 8, 8,
    8, 8, 15, 15, 8, 4, 8, 4,
    8, 8, 8, 8, 15, 15, 4, 4,
  };
  if (argc != 2) return 2;
  char path[1024];
  snprintf(path, sizeof(path), "%s/external-low-depth-gray1.jp2", argv[1]);
  if (write_image(path, 1, 1, 0, OPJ_CLRSPC_GRAY, gray1)) return 1;
  snprintf(path, sizeof(path), "%s/external-low-depth-gray4.jp2", argv[1]);
  if (write_image(path, 1, 4, 0, OPJ_CLRSPC_GRAY, gray4)) return 1;
  snprintf(path, sizeof(path), "%s/external-low-depth-signed-gray4.jp2", argv[1]);
  if (write_image(path, 1, 4, 1, OPJ_CLRSPC_GRAY, signed_gray4)) return 1;
  snprintf(path, sizeof(path), "%s/external-low-depth-gray-alpha1.jp2", argv[1]);
  if (write_image(path, 2, 1, 0, OPJ_CLRSPC_GRAY, gray_alpha1)) return 1;
  snprintf(path, sizeof(path), "%s/external-low-depth-sycc4.jp2", argv[1]);
  return write_image(path, 3, 4, 0, OPJ_CLRSPC_SYCC, sycc4);
}
