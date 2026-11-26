#include <stddef.h>
#include <stdio.h>
#include <jpeglib.h>
#include <setjmp.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

void jpeg_cleanup_scan_buffers(j_compress_ptr cinfo);

typedef struct {
  struct jpeg_error_mgr pub;
  jmp_buf jump;
} mozjpeg_error_mgr;

typedef struct {
  struct jpeg_compress_struct cinfo;
  mozjpeg_error_mgr error;
  unsigned char *jpeg_data;
  unsigned long jpeg_size;
} mozjpeg_encode_state;

static void mozjpeg_error_exit(j_common_ptr cinfo) {
  mozjpeg_error_mgr *error = (mozjpeg_error_mgr *)cinfo->err;
  longjmp(error->jump, 1);
}

static void store_u32_le(uint8_t *destination, uint32_t value) {
  destination[0] = (uint8_t)value;
  destination[1] = (uint8_t)(value >> 8);
  destination[2] = (uint8_t)(value >> 16);
  destination[3] = (uint8_t)(value >> 24);
}

int mozjpeg_encode(const uint8_t *rgba, int width, int height, int quality,
                   int subsample, int progressive, int optimize_coding,
                   uint8_t *result) {
  mozjpeg_encode_state *state;
  uint64_t input_size;

  if (result == NULL) return 1;
  memset(result, 0, 8);
  if (rgba == NULL || width <= 0 || height <= 0 || width > 65500 ||
      height > 65500 || quality < 1 || quality > 100 ||
      (subsample != 420 && subsample != 422 && subsample != 444) ||
      (progressive != 0 && progressive != 1) ||
      (optimize_coding != 0 && optimize_coding != 1))
    return 1;

  input_size = (uint64_t)(unsigned int)width *
               (uint64_t)(unsigned int)height * 4;
  if (input_size > UINT32_MAX) return 1;

  state = (mozjpeg_encode_state *)calloc(1, sizeof(*state));
  if (state == NULL) return 2;
  state->cinfo.err = jpeg_std_error(&state->error.pub);
  state->error.pub.error_exit = mozjpeg_error_exit;

  if (setjmp(state->error.jump)) {
    jpeg_cleanup_scan_buffers(&state->cinfo);
    jpeg_destroy_compress(&state->cinfo);
    free(state->jpeg_data);
    free(state);
    return 2;
  }

  jpeg_create_compress(&state->cinfo);
  state->cinfo.image_width = (JDIMENSION)width;
  state->cinfo.image_height = (JDIMENSION)height;
  state->cinfo.input_components = 4;
  state->cinfo.in_color_space = JCS_EXT_RGBA;

  jpeg_c_set_int_param(&state->cinfo, JINT_COMPRESS_PROFILE,
                       JCP_MAX_COMPRESSION);
  jpeg_set_defaults(&state->cinfo);
  jpeg_set_quality(&state->cinfo, quality, TRUE);

  state->cinfo.comp_info[0].h_samp_factor = subsample == 444 ? 1 : 2;
  state->cinfo.comp_info[0].v_samp_factor = subsample == 420 ? 2 : 1;
  state->cinfo.comp_info[1].h_samp_factor = 1;
  state->cinfo.comp_info[1].v_samp_factor = 1;
  state->cinfo.comp_info[2].h_samp_factor = 1;
  state->cinfo.comp_info[2].v_samp_factor = 1;
  state->cinfo.optimize_coding = optimize_coding ? TRUE : FALSE;

  if (progressive) {
    jpeg_c_set_bool_param(&state->cinfo, JBOOLEAN_OPTIMIZE_SCANS, TRUE);
  } else {
    jpeg_c_set_bool_param(&state->cinfo, JBOOLEAN_OPTIMIZE_SCANS, FALSE);
    state->cinfo.scan_info = NULL;
    state->cinfo.num_scans = 0;
    state->cinfo.progressive_mode = FALSE;
  }

  jpeg_mem_dest(&state->cinfo, &state->jpeg_data, &state->jpeg_size);
  jpeg_start_compress(&state->cinfo, TRUE);
  while (state->cinfo.next_scanline < state->cinfo.image_height) {
    JSAMPROW row = (JSAMPROW)(rgba + (uint32_t)state->cinfo.next_scanline *
                                       (uint32_t)width * 4);
    jpeg_write_scanlines(&state->cinfo, &row, 1);
  }
  jpeg_finish_compress(&state->cinfo);
  jpeg_destroy_compress(&state->cinfo);

  if (state->jpeg_data == NULL || state->jpeg_size == 0 ||
      state->jpeg_size > UINT32_MAX) {
    free(state->jpeg_data);
    free(state);
    return 2;
  }

  store_u32_le(result, (uint32_t)(uintptr_t)state->jpeg_data);
  store_u32_le(result + 4, (uint32_t)state->jpeg_size);
  free(state);
  return 0;
}
